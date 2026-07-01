// src/server/lib/scenario-data.ts
//
// Lettura dei dati REALI dal DB per costruire l'input di
// `buildForfettarioMethodComparison` (tax-engine). Isola tutte le query dal
// route `GET /api/tax/scenario`: qui NON c'è logica fiscale (sta nel motore) —
// solo SELECT su year_settings / fatture / pagamenti e assemblaggio del
// ComparisonInput.
//
// Convenzioni mutuate da `scadenziario-service.ts` (stesso boundary DB↔motore):
//  - `grossCollected` = somma `importo - ritenuta` delle fatture con
//    `pag_anno = year` (le incassate: il `/paga` valorizza pag_anno/pag_mese e
//    porta lo stato a 'pagata'; le bozze/inviate non hanno pag_anno).
//  - breakdown mensile su `pag_mese` (stessa fonte del totale).
//  - acconti REALI (fix A6): somma dei pagamenti puri + breakdown linkedKeys
//    per le scheduleKey degli acconti imposta/contributi DELL'ANNO N — cioè
//    quelli versati PER l'anno d'imposta N (30/06/N e 30/11/N) che ne riducono
//    il saldo (`taxSaldo`, LM45/LM46). NB: NON gli acconti _{N-1} (quelli
//    riducono il saldo dell'anno precedente lato scadenziario-service).
//  - base acconti storico (`previousTaxBase` e `previousContribution.
//    saldoAccontoBase`): imposta e contributi variabili DOVUTI l'anno
//    precedente, RICOSTRUITI dallo storico fatture di N-1 con lo stesso motore
//    (`loadStoricoPriorSeeds`, ricorsione lungo la catena degli anni). Se N-1
//    non è tracciato si ripiega sui campi manuali `primoAnno*` di
//    year_settings(year); se nulla è valorizzato → 0 (default motore).
//
// Ritorna `null` se mancano le year_settings dell'anno: il route risponderà
// `{ needsConfig: true }`.

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { yearSettings, fatture, pagamenti } from '../db/schema';
import { buildScheduleKey } from '@shared/schedule-keys';
import { coefficienteRiduzioneInps } from '@shared/forfettario-rules';
import { getInpsArtComForYear } from '@shared/inps-params';
import { sommaRicaviCassa, ricaviCassaPerMese } from '@shared/ricavi-cassa';
import { loadStoricoPriorSeeds } from './storico-base';
import type { ComparisonInput, ContributionParams } from './tax-engine';

type YearSettingsRow = typeof yearSettings.$inferSelect;

export interface ScenarioData {
  grossCollected: number;
  /** Lordo incassato per mese (solo i mesi con incassi, ordinati). */
  monthly: { month: number; lordo: number }[];
  /** Pronto per buildForfettarioMethodComparison. */
  comparisonInput: ComparisonInput;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchYearSettings(
  db: Db,
  profileId: string,
  year: number,
): Promise<YearSettingsRow | null> {
  const rows = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  return rows[0] ?? null;
}

/**
 * Fatturato incassato dell'anno + breakdown per mese. Sorgente: fatture con
 * `pag_anno = year` (l'incasso è registrato da `/paga`). Importo netto della
 * ritenuta, come `scadenziario-service.loadGrossCollected`. Fallback al
 * `primoAnnoFatturatoPrec` di year_settings se non ci sono incassi (primo anno
 * su Lira con fatturato inserito a mano).
 */
async function loadGrossCollectedMonthly(
  db: Db,
  profileId: string,
  year: number,
  ys: YearSettingsRow,
): Promise<{ grossCollected: number; monthly: { month: number; lordo: number }[] }> {
  // Carichiamo tutte le fatture del profilo e applichiamo le regole di cassa
  // condivise (`@shared/ricavi-cassa`): anno di incasso = pag_anno o, se manca,
  // anno di dataPagamento; NC (TD04) sottratte; bozze escluse. Il filtro non è
  // più in SQL su `pag_anno` per poter recuperare le incassate senza pag_anno.
  const rows = await db.select().from(fatture).where(eq(fatture.profileId, profileId));

  const grossCollected = sommaRicaviCassa(rows, year);
  const monthly = ricaviCassaPerMese(rows, year);
  if (grossCollected !== 0 || monthly.length > 0) {
    return { grossCollected, monthly };
  }

  if (ys.primoAnnoFatturatoPrec != null) {
    return { grossCollected: round2(Number(ys.primoAnnoFatturatoPrec)), monthly: [] };
  }
  return { grossCollected: 0, monthly: [] };
}

/** Parsea `linkedKeys` (TEXT JSON) in `[{ key, amount }]`; null se malformato. */
function parseLinkedKeys(raw: string): Array<{ key: string; amount: number }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: Array<{ key: string; amount: number }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key : null;
    const amount = typeof rec.amount === 'number' ? rec.amount : null;
    if (key !== null && amount !== null) out.push({ key, amount });
  }
  return out;
}

/**
 * Somma gli acconti REALMENTE versati per le chiavi richieste, contando sia i
 * pagamenti puri (`scheduleKey` ∈ keys) sia i misti (`linkedKeys` breakdown).
 * Port da `scadenziario-service.sumAccontiReali`.
 */
async function sumAccontiReali(db: Db, profileId: string, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;

  const pure = await db
    .select()
    .from(pagamenti)
    .where(and(eq(pagamenti.profileId, profileId), inArray(pagamenti.scheduleKey, keys)));
  let total = 0;
  for (const p of pure) total += Number(p.importo) || 0;

  const all = await db.select().from(pagamenti).where(eq(pagamenti.profileId, profileId));
  for (const p of all) {
    if (p.scheduleKey) continue; // già contato nel ramo puro
    if (!p.linkedKeys) continue;
    const breakdown = parseLinkedKeys(p.linkedKeys);
    if (!breakdown) continue;
    for (const b of breakdown) {
      if (keys.includes(b.key)) total += Number(b.amount) || 0;
    }
  }
  return round2(total);
}

/**
 * Parametri contributivi per uno scenario. Port da
 * `scadenziario-service.buildContributionParams`: art/com → quota fissa annua
 * dalla tabella INPS (× 0.65 se riduzione 35%); gestione separata → niente
 * quota fissa. Anni non pubblicati → fixedAnnual 0.
 */
function buildContributionParams(
  ys: YearSettingsRow | null,
  year: number,
  saldoAccontoBase: number,
): ContributionParams {
  if (!ys || ys.inpsMode !== 'artigiani_commercianti') {
    return { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase };
  }
  let quota = 0;
  try {
    const params = getInpsArtComForYear(year);
    quota =
      ys.inpsCategoria === 'commerciante'
        ? params.quotaFissaAnnuaCommerciante
        : params.quotaFissaAnnuaArtigiano;
  } catch {
    quota = 0;
  }
  // Fix A2: riduzione 35% solo se attiva E comunicata a INPS entro 28/02.
  const riduzione = coefficienteRiduzioneInps(ys.riduzione35, ys.riduzione35Comunicata);
  return {
    mode: 'artigiani_commercianti',
    fixedAnnual: quota * riduzione,
    saldoAccontoBase,
    categoria: ys.inpsCategoria === 'commerciante' ? 'commerciante' : 'artigiano',
  };
}

/**
 * Legge i dati reali del profilo per l'anno e assembla il `ComparisonInput`
 * pronto per `buildForfettarioMethodComparison`. Ritorna `null` se mancano le
 * year_settings dell'anno (il route risponderà needsConfig).
 */
export async function loadScenarioData(
  db: Db,
  profileId: string,
  year: number,
): Promise<ScenarioData | null> {
  const ys = await fetchYearSettings(db, profileId, year);
  if (!ys) return null;
  const ysPrev = await fetchYearSettings(db, profileId, year - 1);

  const { grossCollected, monthly } = await loadGrossCollectedMonthly(db, profileId, year, ys);

  // Base "storico" degli acconti = imposta e contributi variabili DOVUTI l'anno
  // precedente, derivati dallo storico fatture di N-1 (o dai campi manuali
  // `primoAnno*Prec` se N-1 non è tracciato). Popola gli acconti anche per i
  // profili importati privi dei campi manuali.
  const priorSeeds = await loadStoricoPriorSeeds(db, profileId, year, ys, buildContributionParams);

  // Parametri contributivi anno N e N-1 (per gli acconti col metodo storico).
  const currentContribution = buildContributionParams(ys, year, 0);
  const previousContribution = buildContributionParams(
    ysPrev,
    year - 1,
    priorSeeds.previousContribVariabili,
  );

  // Acconti REALMENTE versati PER l'anno d'imposta N (rate 30/06/N e 30/11/N,
  // competenceYear = N): sono quelli che riducono il saldo dell'imposta N
  // (`taxSaldo` nello scenario, LM45/LM46 in dichiarazione). FIX re-audit ALTO
  // #1: qui vanno le chiavi dell'anno N, NON N-1 — gli acconti _{N-1} riducono
  // il saldo dell'anno PRECEDENTE (dovuto 30/06/N) ed è lo scadenziario-service
  // a sommarli per la propria riga `imposta_saldo_{N-1}`, non questo scenario.
  const accontiSostitutivaPagatiReali = await sumAccontiReali(db, profileId, [
    buildScheduleKey('imposta_acc1', year),
    buildScheduleKey('imposta_acc2', year),
  ]);
  const accontiContribPagatiReali = await sumAccontiReali(db, profileId, [
    buildScheduleKey('contributi_acc1', year),
    buildScheduleKey('contributi_acc2', year),
  ]);

  const methodSetting: 'storico' | 'previsionale' =
    ys.scadenziarioMetodo === 'previsionale' ? 'previsionale' : 'storico';

  const comparisonInput: ComparisonInput = {
    year,
    method: methodSetting,
    settings: {
      coefficiente: Number(ys.coefficiente),
      impostaSostitutiva: Number(ys.impostaSostitutiva),
      // Fix A2: riduzione applicata solo se attiva E comunicata a INPS.
      riduzione35: (ys.riduzione35 === 1 && ys.riduzione35Comunicata === 1),
    },
    grossCollected,
    currentContribution,
    previousContribution,
    previousTaxBase: priorSeeds.previousTaxBase,
    previousContributionAccontiPaid: Number(
      ysPrev?.primoAnnoAccontiContribPrec ?? ys.primoAnnoAccontiContribPrec ?? 0,
    ),
    accontiSostitutivaPagatiReali,
    accontiContribPagatiReali,
    methodSetting,
    currentSettings: { regime: ys.regime, haRedditoDipendente: ys.haRedditoDipendente },
    previousSettings: ysPrev
      ? { regime: ysPrev.regime, haRedditoDipendente: ysPrev.haRedditoDipendente }
      : {},
  };

  return { grossCollected, monthly, comparisonInput };
}
