// src/server/services/scadenziario-service.ts
//
// Orchestratore I/O dello scadenziario fiscale forfettario per un dato
// `profileId × year`. Si trova fra DB (Drizzle) e le pure functions in
// `lib/tax-engine` + `lib/scadenziario-engine`:
//
//   ┌── DB ─────────────────────────────────────────────────────────┐
//   │ year_settings, profiles, fatture, pagamenti                  │
//   └────────────┬──────────────────────────────────────────────────┘
//                │ load + shape
//                ▼
//   ┌── scadenziario-service.buildScadenziarioView ────────────────┐
//   │ - fetchYearSettings (N, N-1)                                 │
//   │ - loadGrossCollected (fatture pag_anno=N, fallback ys)       │
//   │ - sumAccontiReali (pagamenti puri + linkedKeys breakdown)    │ ← FIX A6
//   │ - buildForfettarioMethodComparison (tax-engine)              │
//   │ - loadPaymentsByKey (pagamenti puri + breakdown)             │
//   │ - loadBolloByQuarter (fatture marca_da_bollo=1 nell'anno)    │
//   │ - buildScadenziario (scadenziario-engine)                    │
//   │ - evaluateAuditChecks (audit-checks)                         │
//   └────────────┬─────────────────────────────────────────────────┘
//                │
//                ▼
//   ScadenziarioView (= ScadenziarioOutput + methodComparison + transition)
//
// **FIX A6** (acconti REALI vs stimati): il saldo di sostitutiva e contributi
// dell'anno N si calcola sottraendo gli acconti VERSATI nell'anno N-1, non
// quelli pianificati. Qui si aggregano i pagamenti puri (scheduleKey match
// per `imposta_acc1_{N-1}` + `imposta_acc2_{N-1}`) e i pagamenti misti
// (linkedKeys JSON breakdown).
//
// **404 boundary**: se `year_settings[profile, year]` manca, il service
// solleva `HttpError(404, 'YEAR_SETTINGS_NOT_FOUND')` che il middleware
// `errorHandler` traduce in JSON. La route può semplicemente await senza
// ulteriore wrapping.

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { yearSettings, pagamenti, fatture, profiles } from '../db/schema';
import {
  buildForfettarioMethodComparison,
  ceil2,
  type ComparisonInput,
  type ContributionParams,
} from '../lib/tax-engine';
import {
  buildScadenziario,
  type ScadenziarioOutput,
  type PaymentBreakdown,
} from '../lib/scadenziario-engine';
import { evaluateAuditChecks, type AuditWarning } from '@shared/audit-checks';
import { sommaRicaviCassa, isIncassoSenzaAnno } from '@shared/ricavi-cassa';
import { loadStoricoPriorSeeds } from '../lib/storico-base';
import { getInpsArtComForYear } from '@shared/inps-params';
import { buildScheduleKey } from '@shared/schedule-keys';
import { coefficienteRiduzioneInps } from '@shared/forfettario-rules';
import { SOGLIA_BOLLO } from '@shared/fattura-logic';
import { HttpError } from '../middleware/error';

// --- Public surface -----------------------------------------------------

/**
 * Output del service: lo `ScadenziarioOutput` puro arricchito con il
 * confronto storico↔previsionale (per il pannello "metodo acconti" del
 * frontend) e la diagnostica di transizione regime/redditi misti.
 */
export interface ScadenziarioView extends ScadenziarioOutput {
  methodComparison: ReturnType<typeof buildForfettarioMethodComparison>;
  transition: ReturnType<typeof buildForfettarioMethodComparison>['transition'];
  /** Hint per il frontend: dove ottenere le costanti legali esposte. */
  rulesRef: string;
}

export interface BuildScadenziarioArgs {
  db: Db;
  profileId: string;
  year: number;
  /** ISO `YYYY-MM-DD`. Se omesso, usa la data odierna UTC. */
  today?: string;
}

type YearSettingsRow = typeof yearSettings.$inferSelect;

// Diritto camerale CCIAA: in 2A è un default fisso (53 €). In 2B diventerà
// configurabile per profilo/CCIAA (registrazione classe maggiorata o ridotta).
const CAMERA_COMMERCE_DEFAULT_2A = 53;

// --- DB loaders (interni) ----------------------------------------------

/**
 * Carica la riga `year_settings` per il profilo e l'anno. Ritorna `null`
 * se non presente (utile per `year - 1` opzionale).
 */
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
 * Cerca la year_settings da cui ereditare quando l'anno richiesto non ha una
 * riga propria: preferisce l'anno salvato più recente ≤ `year`; se nessuno lo
 * precede, ripiega sul più antico disponibile. Ritorna `null` solo se il
 * profilo non ha ALCUNA year_settings (mai configurato).
 */
async function fetchInheritableYearSettings(
  db: Db,
  profileId: string,
  year: number,
): Promise<YearSettingsRow | null> {
  const rows = await db
    .select()
    .from(yearSettings)
    .where(eq(yearSettings.profileId, profileId));
  if (rows.length === 0) return null;
  const atOrBefore = rows.filter((r) => r.year <= year).sort((a, b) => b.year - a.year);
  if (atOrBefore[0]) return atOrBefore[0];
  return rows.slice().sort((a, b) => a.year - b.year)[0] ?? null;
}

/**
 * Deriva una year_settings "stimata" per `year` da una riga sorgente di un
 * altro anno: eredita l'identità fiscale (regime, coefficiente, imposta, INPS,
 * riduzione 35%, redditi misti, limite, metodo) e AZZERA i campi one-off legati
 * all'anno di origine — override manuali, proroga saldo, stato comunicazione
 * riduzione 35%, carry-in "primo anno", base mese budget — che non ha senso
 * propagare a un anno solo stimato. Row in-memory: non viene mai persistita.
 */
function deriveInheritedYearSettings(base: YearSettingsRow, year: number): YearSettingsRow {
  return {
    ...base,
    year,
    overrides: null,
    prorogaSaldoAt: null,
    riduzione35Comunicata: 0,
    riduzione35DataComunicazione: null,
    primoAnnoFatturatoPrec: null,
    primoAnnoImpostaPrec: null,
    primoAnnoAccontiImpostaPrec: null,
    primoAnnoContribVariabiliPrec: null,
    primoAnnoAccontiContribPrec: null,
    budgetBaseMonth: null,
  };
}

/**
 * Calcola il fatturato lordo dell'anno usato per le simulazioni fiscali.
 * Priorità:
 * 1. Somma `fatture.importo - ritenuta` con `pag_anno = year` (escluse le
 *    righe non ancora incassate, per cui `pag_anno IS NULL`).
 * 2. Fallback su `year_settings.primoAnnoFatturatoPrec` se l'anno è il
 *    primo e l'utente ha registrato il fatturato a mano.
 * 3. Default 0.
 */
async function loadGrossCollected(
  db: Db,
  profileId: string,
  year: number,
  ys: YearSettingsRow,
): Promise<number> {
  // Regole di cassa condivise (`@shared/ricavi-cassa`): anno di incasso =
  // pag_anno o anno di dataPagamento; NC (TD04) sottratte; bozze escluse.
  const rows = await db.select().from(fatture).where(eq(fatture.profileId, profileId));
  const gross = sommaRicaviCassa(rows, year);
  if (gross !== 0) return gross;
  if (ys.primoAnnoFatturatoPrec != null) {
    return Number(ys.primoAnnoFatturatoPrec);
  }
  return 0;
}

/**
 * Somma gli acconti REALMENTE versati per le chiavi richieste, considerando
 * sia i pagamenti puri (`scheduleKey` match) sia i pagamenti misti
 * (`linkedKeys` JSON breakdown). I pagamenti misti hanno `scheduleKey = null`
 * e una struttura JSON `[{ key, amount }]` in `linkedKeys`.
 *
 * Implementazione FIX A6: il chiamante passa le chiavi degli acconti
 * sostitutiva (o contributi) dell'anno precedente — questo importo viene
 * sottratto dal saldo dell'anno N nello scenario forfettario.
 */
async function sumAccontiReali(
  db: Db,
  profileId: string,
  accontoKeys: string[],
): Promise<number> {
  if (accontoKeys.length === 0) return 0;

  // Pagamenti puri imputati direttamente a una scheduleKey degli acconti.
  const pure = await db
    .select()
    .from(pagamenti)
    .where(
      and(eq(pagamenti.profileId, profileId), inArray(pagamenti.scheduleKey, accontoKeys)),
    );
  let total = 0;
  for (const p of pure) {
    total += Number(p.importo) || 0;
  }

  // Pagamenti misti: scheduleKey è null ma linkedKeys contiene un breakdown.
  // NB: filtriamo lato JS perché il filtro su scheduleKey IS NULL andrebbe
  // espresso con `isNull` ed è preferibile evitare un secondo round-trip:
  // qui carichiamo tutti i pagamenti del profile (cardinalità contenuta:
  // ~50/anno tipici) e iteriamo. Per profili HV passeremo a query mirata.
  const allOfProfile = await db
    .select()
    .from(pagamenti)
    .where(eq(pagamenti.profileId, profileId));
  for (const p of allOfProfile) {
    if (p.scheduleKey) continue; // già contato nel ramo "puro"
    if (!p.linkedKeys) continue;
    const breakdown = parseLinkedKeys(p.linkedKeys);
    if (!breakdown) continue;
    for (const b of breakdown) {
      if (accontoKeys.includes(b.key)) {
        total += Number(b.amount) || 0;
      }
    }
  }

  // Arrotonda a 2 decimali per evitare drift FP nei test.
  return Math.round(total * 100) / 100;
}

/**
 * Parsea `linkedKeys` (TEXT JSON nel DB) in `[{ key, amount }]`. Restituisce
 * `null` se il JSON è malformato o se la struttura non corrisponde. Le
 * voci con `key`/`amount` mancanti o non-stringa/non-numero vengono filtrate.
 */
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
    if (key !== null && amount !== null) {
      out.push({ key, amount });
    }
  }
  return out;
}

/**
 * Costruisce la mappa `scheduleKey → { paidTotal, payments[] }` per TUTTI i
 * pagamenti del profilo. Include:
 * - pagamenti puri: contribuiscono direttamente alla loro chiave con `mode: 'pure'`.
 * - pagamenti misti: ogni voce del breakdown contribuisce alla rispettiva
 *   chiave con `mode: 'mixed'` e `importo = amount` della voce.
 *
 * Questa mappa viene consumata da `buildScadenziario` per associare ad ogni
 * riga il `paidTotal` e l'array `payments` (necessari per status + UI dettaglio).
 */
async function loadPaymentsByKey(
  db: Db,
  profileId: string,
): Promise<Map<string, { paidTotal: number; payments: PaymentBreakdown[] }>> {
  const rows = await db.select().from(pagamenti).where(eq(pagamenti.profileId, profileId));
  const map = new Map<string, { paidTotal: number; payments: PaymentBreakdown[] }>();

  for (const p of rows) {
    const importo = Number(p.importo);
    const data = String(p.data);
    if (p.scheduleKey) {
      const entry = map.get(p.scheduleKey) ?? { paidTotal: 0, payments: [] };
      entry.paidTotal += importo;
      entry.payments.push({ id: p.id, data, importo, mode: 'pure' });
      map.set(p.scheduleKey, entry);
      continue;
    }
    if (!p.linkedKeys) continue;
    const breakdown = parseLinkedKeys(p.linkedKeys);
    if (!breakdown) continue;
    for (const b of breakdown) {
      const entry = map.get(b.key) ?? { paidTotal: 0, payments: [] };
      entry.paidTotal += b.amount;
      entry.payments.push({ id: p.id, data, importo: b.amount, mode: 'mixed' });
      map.set(b.key, entry);
    }
  }

  // Arrotonda i totali per stabilità di confronto con i range engine.
  for (const v of map.values()) {
    v.paidTotal = Math.round(v.paidTotal * 100) / 100;
  }
  return map;
}

/**
 * Calcola la marca da bollo dovuta divisa per rata di versamento (DM
 * 17/06/2014, soglia 5.000 € DL 73/2022): Q1+Q2 (mesi 1-6 → 30/09, col Q1
 * differito sotto soglia), Q3 (mesi 7-9 → 30/11, scadenza legale del III
 * trimestre) e Q4 (mesi 10-12 → 28/02 N+1). 2 € per ciascuna fattura con
 * `marca_da_bollo=1` e `data` nell'anno richiesto.
 */
async function loadBolloByQuarter(
  db: Db,
  profileId: string,
  year: number,
): Promise<{ q12: number; q3: number; q4: number }> {
  const rows = await db.select().from(fatture).where(eq(fatture.profileId, profileId));
  const prefix = `${year}-`;
  let q12 = 0;
  let q3 = 0;
  let q4 = 0;
  for (const f of rows) {
    if (f.marcaDaBollo !== 1) continue;
    // Fix M1: il bollo è dovuto solo su documenti EMESSI. Le bozze (che possono
    // avere il flag valorizzato manualmente prima dell'invio) e le note di
    // credito (TD04, esenti) non concorrono all'F24 trimestrale.
    if (f.stato === 'bozza') continue;
    if (f.tipoDocumento === 'TD04') continue;
    // Fix re-audit MEDIO #6: il bollo virtuale da 2 € è dovuto solo se
    // l'imponibile supera 77,47 € (art. 6 DM 17/06/2014). Un flag `marca_da_bollo`
    // rimasto attivo su una fattura sotto soglia (fatture.ts conserva il flag
    // manuale) NON emette <DatiBollo> nell'XML: conteggiarlo qui gonfierebbe
    // l'F24 rispetto al documento reale. Stessa soglia strict di fattura-xml.
    if (!(Number(f.importo) > SOGLIA_BOLLO)) continue;
    const date = String(f.data);
    if (!date.startsWith(prefix)) continue;
    const monthStr = date.slice(5, 7);
    const month = parseInt(monthStr, 10);
    if (!Number.isFinite(month)) continue;
    if (month >= 1 && month <= 6) {
      q12 += 2;
    } else if (month >= 7 && month <= 9) {
      q3 += 2;
    } else {
      q4 += 2;
    }
  }
  return { q12, q3, q4 };
}

/**
 * Conta le fatture che risultano INCASSATE ma senza un anno di incasso
 * determinabile (`pag_anno` e `dataPagamento` entrambi assenti): i loro ricavi
 * non entrano in alcun anno e vanno segnalati (fix A3, "pagamenti persi").
 */
async function countIncassiSenzaAnno(db: Db, profileId: string): Promise<number> {
  const rows = await db
    .select({
      importo: fatture.importo,
      pagAnno: fatture.pagAnno,
      stato: fatture.stato,
      tipoDocumento: fatture.tipoDocumento,
      dataPagamento: fatture.dataPagamento,
    })
    .from(fatture)
    .where(eq(fatture.profileId, profileId));
  let n = 0;
  for (const f of rows) if (isIncassoSenzaAnno(f)) n++;
  return n;
}

// --- INPS shaping -------------------------------------------------------

/**
 * Costruisce i parametri contributivi per uno scenario forfettario:
 * - artigiani/commercianti: quota fissa annua dalla tabella INPS_ARTCOM
 *   selezionando artigiano vs commerciante, eventualmente moltiplicata per
 *   il coefficiente di riduzione 35% (se il flag è attivo).
 * - gestione separata: niente quota fissa.
 *
 * Per gli anni non ancora pubblicati in `INPS_ARTCOM` (es. anno futuro non
 * coperto), `getInpsArtComForYear` solleva; qui catturiamo l'errore e
 * restituiamo `null` lasciando al chiamante decidere il fallback (a
 * `fixedAnnual: 0`). Lo scadenziario-engine ha la stessa convenzione.
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
  // Fix A2: la riduzione 35% si applica solo se attiva E comunicata a INPS.
  const riduzione = coefficienteRiduzioneInps(ys.riduzione35, ys.riduzione35Comunicata);
  return {
    mode: 'artigiani_commercianti',
    fixedAnnual: quota * riduzione,
    saldoAccontoBase,
    categoria: ys.inpsCategoria === 'commerciante' ? 'commerciante' : 'artigiano',
  };
}

// --- Public function ----------------------------------------------------

/**
 * Punto di ingresso del service: produce la `ScadenziarioView` per la coppia
 * `profileId × year`. La funzione è "thin": tutta la logica fiscale e di
 * scheduling vive negli engine puri; qui orchestriamo solo le query, lo
 * shaping degli input e l'aggregazione dei warning.
 *
 * Throws:
 * - `HttpError(404, 'YEAR_SETTINGS_NOT_FOUND')` se manca year_settings.
 * - `HttpError(404, 'PROFILE_NOT_FOUND')` se il profilo è stato cancellato
 *   in concomitanza con la chiamata (race rara, ma protezione difensiva).
 */
export async function buildScadenziarioView(
  args: BuildScadenziarioArgs,
): Promise<ScadenziarioView> {
  const { db, profileId, year } = args;
  const today = args.today ?? new Date().toISOString().slice(0, 10);

  // 1. year_settings — N e N-1 (quest'ultimo opzionale per il primo anno).
  //
  // Carry-forward (parità con CalcoliVari): se l'anno N non ha una riga propria
  // ma il profilo ne ha almeno una in un ALTRO anno, ereditiamo l'identità
  // fiscale dall'anno salvato più vicino (≤ N, altrimenti il più antico) e la
  // marchiamo come STIMA (warning YEAR_SETTINGS_INHERITED). Il 404 resta solo
  // per profili senza ALCUNA year_settings (mai configurati).
  let ys = await fetchYearSettings(db, profileId, year);
  let inheritedFromYear: number | null = null;
  if (!ys) {
    const base = await fetchInheritableYearSettings(db, profileId, year);
    if (!base) {
      // Nessuna year_settings per nessun anno → profilo non configurato.
      // Il code è incluso nel messaggio: `assert.rejects` (e i log applicativi)
      // matchano `YEAR_SETTINGS_NOT_FOUND` direttamente nel `Error.toString()`.
      throw new HttpError(
        404,
        'YEAR_SETTINGS_NOT_FOUND',
        `YEAR_SETTINGS_NOT_FOUND: year_settings non trovata per profile=${profileId} year=${year}`,
      );
    }
    ys = deriveInheritedYearSettings(base, year);
    inheritedFromYear = base.year;
  }
  const ysPrev = await fetchYearSettings(db, profileId, year - 1);

  // 2. profilo + estrazione `data_inizio_attivita` (JSON in `attivita`).
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  if (!profile) {
    throw new HttpError(
      404,
      'PROFILE_NOT_FOUND',
      `PROFILE_NOT_FOUND: profile=${profileId} non trovato`,
    );
  }
  const dataInizioAttivita = extractDataInizioAttivita(profile.attivita, year);

  // 3. fatturato lordo dell'anno (fatture pagate o fallback).
  const grossCollected = await loadGrossCollected(db, profileId, year, ys);

  // 4. base "storico" degli acconti = imposta e contributi variabili DOVUTI
  //    l'anno precedente. Derivati dallo storico fatture di N-1 (o dei campi
  //    manuali `primoAnno*Prec` se N-1 non è tracciato). Questo popola gli
  //    acconti anche per i profili importati che non hanno i campi manuali.
  const priorSeeds = await loadStoricoPriorSeeds(db, profileId, year, ys, buildContributionParams);

  // 5. parametri contributivi per i due scenari (storico vs previsionale).
  const currentContribution = buildContributionParams(ys, year, 0);
  const previousContribution = buildContributionParams(
    ysPrev,
    year - 1,
    priorSeeds.previousContribVariabili,
  );

  // 6. FIX A6: acconti REALMENTE versati nell'anno precedente.
  const prevYear = year - 1;
  const accontiSostitutivaKeys = [
    buildScheduleKey('imposta_acc1', prevYear),
    buildScheduleKey('imposta_acc2', prevYear),
  ];
  const accontiContribKeys = [
    buildScheduleKey('contributi_acc1', prevYear),
    buildScheduleKey('contributi_acc2', prevYear),
  ];
  const accontiSostitutivaPagatiReali = await sumAccontiReali(
    db,
    profileId,
    accontiSostitutivaKeys,
  );
  const accontiContribPagatiReali = await sumAccontiReali(
    db,
    profileId,
    accontiContribKeys,
  );

  // 7. comparison input — usa metodo "storico" (build di entrambi gli scenari).
  // La `methodSetting` decide quale dei due "selected" exporremo.
  const methodSetting = (ys.scadenziarioMetodo === 'previsionale' ? 'previsionale' : 'storico') as
    | 'storico'
    | 'previsionale';

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
      ysPrev?.primoAnnoAccontiContribPrec ?? 0,
    ),
    accontiSostitutivaPagatiReali,
    accontiContribPagatiReali,
    methodSetting,
    currentSettings: {
      regime: ys.regime,
      haRedditoDipendente: ys.haRedditoDipendente,
    },
    previousSettings: ysPrev
      ? {
          regime: ysPrev.regime,
          haRedditoDipendente: ysPrev.haRedditoDipendente,
        }
      : {},
  };

  const methodComparison = buildForfettarioMethodComparison(comparisonInput);

  // Fix A1: saldo di competenza N-1 (dovuto 30/06/N) calcolato sull'anno N-1 =
  // imposta/contributi variabili DOVUTI per N-1 (dallo storico fatture, via
  // priorSeeds) meno gli acconti REALMENTE versati per N-1. NON si usa
  // `scenario.taxSaldo`/`contributionSaldo` (calcolati sul reddito N).
  //
  // Fix re-audit MEDIO #7 — PRIMO ANNO tracciato: quando N-1 NON è tracciato,
  // priorSeeds viene dai campi manuali `primoAnnoImpostaPrec/ContribVariabiliPrec`
  // (importi LORDI dovuti per N-1) e NON esistono pagamenti reali di acconto
  // _{N-1}. In quel caso gli acconti già versati per N-1 sono i campi manuali
  // `primoAnnoAccontiImpostaPrec/ContribPrec`, altrimenti il saldo risulterebbe
  // gonfiato dell'intero acconto già pagato. Se N-1 è tracciato usiamo i soli
  // acconti reali (i campi primoAnno* non sono pertinenti).
  const accontiImpostaSaldoPrec = priorSeeds.computedFromInvoices
    ? accontiSostitutivaPagatiReali
    : accontiSostitutivaPagatiReali + Number(ys.primoAnnoAccontiImpostaPrec ?? 0);
  const accontiContribSaldoPrec = priorSeeds.computedFromInvoices
    ? accontiContribPagatiReali
    : accontiContribPagatiReali + Number(ys.primoAnnoAccontiContribPrec ?? 0);
  const saldoPrecedente = {
    imposta: ceil2(Math.max(priorSeeds.previousTaxBase - accontiImpostaSaldoPrec, 0)),
    contributi: ceil2(Math.max(priorSeeds.previousContribVariabili - accontiContribSaldoPrec, 0)),
  };

  // 8. pagamenti per schedule key + bollo trimestrale.
  const paymentsByKey = await loadPaymentsByKey(db, profileId);
  const bolloByQuarter = await loadBolloByQuarter(db, profileId, year);

  // 9. costruzione scadenziario "puro". Lo shape della yearSettings qui
  // converte i nomi camelCase del DB nei nomi snake-case richiesti
  // dall'engine (riduzione_35, riduzione_35_comunicata).
  const scadOut = buildScadenziario({
    year,
    yearSettings: {
      regime: ys.regime,
      coefficiente: Number(ys.coefficiente),
      impostaSostitutiva: Number(ys.impostaSostitutiva),
      inpsMode: ys.inpsMode as 'artigiani_commercianti' | 'gestione_separata',
      inpsCategoria: ys.inpsCategoria ?? null,
      riduzione_35: ys.riduzione35,
      riduzione_35_comunicata: ys.riduzione35Comunicata,
      haRedditoDipendente: ys.haRedditoDipendente,
      scadenziarioMetodo: methodSetting,
      prorogaSaldoAt: ys.prorogaSaldoAt ?? null,
    },
    previousYearSettings: ysPrev
      ? {
          regime: ysPrev.regime,
          coefficiente: Number(ysPrev.coefficiente),
          impostaSostitutiva: Number(ysPrev.impostaSostitutiva),
          inpsMode: ysPrev.inpsMode as 'artigiani_commercianti' | 'gestione_separata',
          inpsCategoria: ysPrev.inpsCategoria ?? null,
          riduzione_35: ysPrev.riduzione35,
          riduzione_35_comunicata: ysPrev.riduzione35Comunicata,
          haRedditoDipendente: ysPrev.haRedditoDipendente,
          scadenziarioMetodo:
            ysPrev.scadenziarioMetodo === 'previsionale' ? 'previsionale' : 'storico',
          prorogaSaldoAt: ysPrev.prorogaSaldoAt ?? null,
        }
      : null,
    scenarios: {
      historical: methodComparison.historical,
      previsionale: methodComparison.previsionale,
    },
    paymentsByKey,
    bolloByQuarter,
    cameraCommerce: CAMERA_COMMERCE_DEFAULT_2A,
    saldoPrecedente,
  });

  // 10. warnings runtime audit (C1, A1, M1, NO_REVENUE_SOURCE).
  const auditWarnings = evaluateAuditChecks({
    year,
    yearSettings: {
      regime: ys.regime,
      coefficiente: Number(ys.coefficiente),
      impostaSostitutiva: Number(ys.impostaSostitutiva),
      inpsMode: ys.inpsMode,
      inpsCategoria: ys.inpsCategoria ?? null,
      riduzione_35: ys.riduzione35,
      riduzione_35_comunicata: ys.riduzione35Comunicata,
      scadenziarioMetodo: methodSetting,
      haRedditoDipendente: ys.haRedditoDipendente,
    },
    profile: { dataInizioAttivita },
    grossCollected,
    today,
  });

  const warnings: AuditWarning[] = [...scadOut.warnings, ...auditWarnings];

  // Fix A3: fatture risultanti incassate ma senza anno di incasso determinabile
  // (pag_anno e dataPagamento assenti) NON entrano nei ricavi → reddito
  // sottostimato. Le segnaliamo invece di perderle silenziosamente.
  const incassiSenzaAnno = await countIncassiSenzaAnno(db, profileId);
  if (incassiSenzaAnno > 0) {
    warnings.unshift({
      code: 'A3_INCASSO_SENZA_ANNO',
      severity: 'warning',
      title: 'Fatture incassate senza data di incasso',
      message:
        `${incassiSenzaAnno} fattura/e risultano incassate ma senza anno/data di incasso: ` +
        `NON sono conteggiate nei ricavi e il reddito potrebbe risultare sottostimato. ` +
        `Apri ciascuna fattura e imposta la data di incasso per includerla.`,
      context: { count: incassiSenzaAnno },
    });
  }

  // Banner "parametri stimati": lo scadenziario usa una year_settings ereditata
  // da un altro anno (vedi carry-forward al punto 1). In testa così è il primo
  // avviso che l'utente legge.
  if (inheritedFromYear !== null) {
    warnings.unshift({
      code: 'YEAR_SETTINGS_INHERITED',
      severity: 'info',
      title: 'Parametri fiscali stimati',
      message:
        `Non hai ancora configurato i parametri fiscali del ${year}: lo scadenziario ` +
        `usa quelli del ${inheritedFromYear} come stima. Configura il ${year} ` +
        `(regime, coefficiente, INPS) per confermare gli importi.`,
      context: { fromYear: inheritedFromYear, year },
    });
  }

  return {
    ...scadOut,
    warnings,
    methodComparison,
    transition: methodComparison.transition,
    rulesRef: `/api/tax/rules?year=${year}`,
  };
}

/**
 * Estrae `data_inizio_attivita` da `profiles.attivita` (TEXT JSON). Supporta
 * sia la chiave snake_case canonica (`data_inizio_attivita`) sia la camelCase
 * (`dataInizioAttivita`) per resilienza all'importer legacy. Fallback al
 * 1° gennaio dell'anno precedente se mancante — l'audit-check A1 vede così
 * un anno "non startup" e ignora il check senza falsi positivi.
 */
function extractDataInizioAttivita(attivitaJson: string | null, year: number): string {
  const fallback = `${year - 1}-01-01`;
  if (!attivitaJson) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(attivitaJson);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;
  const obj = parsed as Record<string, unknown>;
  const v = obj.data_inizio_attivita ?? obj.dataInizioAttivita;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }
  return fallback;
}
