// src/server/lib/storico-base.ts
//
// Base "storico" degli acconti = imposta e contributi variabili DOVUTI per
// l'anno precedente. Nel metodo storico gli acconti dell'anno N si calcolano
// sulla base dell'imposta/contributi dell'anno N-1 (art. 17 c. 3 DPR 435/2001).
//
// **Problema risolto**: prima questa base veniva letta SOLO da campi manuali
// (`primoAnnoImpostaPrec`, `primoAnnoContribVariabiliPrec`) pensati come
// carry-in per il PRIMO anno tracciato. I profili importati da CalcoliVari non
// li hanno valorizzati → base 0 → acconti tutti a 0 pur avendo fatture reali.
//
// **Soluzione**: derivare l'imposta e i contributi variabili dell'anno N-1
// RICOSTRUENDOLI dalle fatture di quell'anno con lo STESSO motore
// (`buildForfettarioScenario`). La derivazione è ricorsiva lungo la catena
// degli anni tracciati: la base per N = imposta di N-1, che a sua volta usa
// come base i suoi acconti = imposta di N-2, ecc. La ricorsione termina al
// primo anno tracciato (quando N-1 non ha year_settings), dove si ripiega sui
// campi manuali `primoAnno*Prec` di quell'anno (o 0).
//
// Proprietà di consistenza (by construction): l'imposta dell'anno Y usata come
// base acconti per Y+1 coincide con l'imposta che l'app MOSTRA per Y — perché
// entrambe passano per lo stesso scenario con gli stessi input. Nessuna
// discrepanza fra "imposta anno scorso" e "base acconto anno corrente".
//
// Costo: 2 query batch per profilo (tutte le year_settings + tutte le fatture),
// poi ricorsione in-memory con memoizzazione. Nessun round-trip per anno.

import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { yearSettings, fatture } from '../db/schema';
import { buildForfettarioScenario, type ContributionParams } from './tax-engine';

type YearSettingsRow = typeof yearSettings.$inferSelect;

/** Firma di `buildContributionParams` dei consumer (service / scenario-data). */
export type BuildContribParams = (
  ys: YearSettingsRow | null,
  year: number,
  saldoAccontoBase: number,
) => ContributionParams;

export interface StoricoPriorSeeds {
  /** Imposta sostitutiva DOVUTA l'anno precedente → base acconti storico imposta. */
  previousTaxBase: number;
  /** Contributi INPS variabili DOVUTI l'anno precedente → base acconti storico contributi. */
  previousContribVariabili: number;
  /**
   * `true` se i valori derivano dallo storico fatture dell'anno precedente
   * (anno N-1 tracciato); `false` se sono i campi manuali `primoAnno*Prec`
   * (o 0). Utile per marcare l'acconto come "stimato dallo storico".
   */
  computedFromInvoices: boolean;
}

interface StoricoResult {
  substituteTax: number;
  contributiVariabiliDovuti: number;
}

interface Loaded {
  ysByYear: Map<number, YearSettingsRow>;
  /** Lordo REALE incassato (importo − ritenuta) per anno, dalle sole fatture con pag_anno. */
  grossByYear: Map<number, number>;
}

/** Carica in 2 query batch le year_settings e il lordo incassato per anno. */
async function preload(db: Db, profileId: string): Promise<Loaded> {
  const ysRows = await db.select().from(yearSettings).where(eq(yearSettings.profileId, profileId));
  const ysByYear = new Map<number, YearSettingsRow>();
  for (const r of ysRows) ysByYear.set(r.year, r);

  const fatRows = await db
    .select({ pagAnno: fatture.pagAnno, importo: fatture.importo, ritenuta: fatture.ritenuta })
    .from(fatture)
    .where(eq(fatture.profileId, profileId));
  const grossByYear = new Map<number, number>();
  for (const f of fatRows) {
    if (f.pagAnno == null) continue; // non incassata → non entra nel lordo dell'anno
    const netto = Number(f.importo) - Number(f.ritenuta ?? 0);
    grossByYear.set(f.pagAnno, (grossByYear.get(f.pagAnno) ?? 0) + netto);
  }
  return { ysByYear, grossByYear };
}

/**
 * Lordo dell'anno usato per la simulazione: fatture reali incassate se
 * presenti, altrimenti fallback su `primoAnnoFatturatoPrec` (primo anno su
 * Lira con fatturato inserito a mano), altrimenti 0. Stessa priorità di
 * `loadGrossCollected` / `loadGrossCollectedMonthly`.
 */
function grossForYear(loaded: Loaded, year: number): number {
  const g = loaded.grossByYear.get(year);
  if (g != null && g !== 0) return g;
  const ys = loaded.ysByYear.get(year);
  if (ys?.primoAnnoFatturatoPrec != null) return Number(ys.primoAnnoFatturatoPrec);
  return g ?? 0;
}

/**
 * Semi (base acconti storico) per lo scenario dell'anno `year`: se l'anno
 * precedente è tracciato, deriva imposta e contributi variabili DOVUTI di
 * `year-1` dallo storico; altrimenti ripiega sui campi manuali di `year`.
 */
function seedsFor(
  loaded: Loaded,
  year: number,
  buildContrib: BuildContribParams,
  memo: Map<number, StoricoResult>,
): StoricoPriorSeeds {
  const ys = loaded.ysByYear.get(year);
  const ysPrev = loaded.ysByYear.get(year - 1);
  if (ysPrev) {
    const b = baseFor(loaded, year - 1, buildContrib, memo);
    return {
      previousTaxBase: b.substituteTax,
      previousContribVariabili: b.contributiVariabiliDovuti,
      computedFromInvoices: true,
    };
  }
  return {
    previousTaxBase: Number(ys?.primoAnnoImpostaPrec ?? 0),
    previousContribVariabili: Number(ys?.primoAnnoContribVariabiliPrec ?? 0),
    computedFromInvoices: false,
  };
}

/**
 * Imposta sostitutiva e contributi variabili DOVUTI per l'anno `year`,
 * ricostruiti dallo storico fatture con lo stesso motore usato dai consumer.
 * Ricorsione memoizzata lungo la catena degli anni tracciati.
 */
function baseFor(
  loaded: Loaded,
  year: number,
  buildContrib: BuildContribParams,
  memo: Map<number, StoricoResult>,
): StoricoResult {
  const cached = memo.get(year);
  if (cached) return cached;

  const ys = loaded.ysByYear.get(year);
  if (!ys) {
    const zero: StoricoResult = { substituteTax: 0, contributiVariabiliDovuti: 0 };
    memo.set(year, zero);
    return zero;
  }
  // Marca provvisoria per interrompere eventuali cicli (anni non monotoni).
  memo.set(year, { substituteTax: 0, contributiVariabiliDovuti: 0 });

  const ysPrev = loaded.ysByYear.get(year - 1) ?? null;
  const seeds = seedsFor(loaded, year, buildContrib, memo);
  const gross = grossForYear(loaded, year);

  const currentContribution = buildContrib(ys, year, 0);
  const previousContribution = buildContrib(ysPrev, year - 1, seeds.previousContribVariabili);

  const scenario = buildForfettarioScenario({
    year,
    method: 'storico',
    settings: {
      coefficiente: Number(ys.coefficiente),
      impostaSostitutiva: Number(ys.impostaSostitutiva),
      riduzione35: ys.riduzione35 === 1,
    },
    grossCollected: gross,
    currentContribution,
    previousContribution,
    previousTaxBase: seeds.previousTaxBase,
    previousContributionAccontiPaid: Number(ysPrev?.primoAnnoAccontiContribPrec ?? 0),
    // Irrilevanti per substituteTax / contributiVariabiliDovuti (agiscono solo
    // sul saldo, non sull'imposta dovuta): li azzeriamo.
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  });

  const result: StoricoResult = {
    substituteTax: scenario.substituteTax,
    contributiVariabiliDovuti: scenario.contributiVariabiliDovuti,
  };
  memo.set(year, result);
  return result;
}

/**
 * Punto d'ingresso: calcola i semi (base acconti storico) per lo scenario
 * dell'anno `year` di un profilo, derivandoli dallo storico fatture dell'anno
 * precedente quando disponibile.
 *
 * @param ys  la year_settings dell'anno `year` così come la vede il consumer
 *            (può essere una riga EREDITATA/stimata, non presente nel DB): la
 *            usiamo come sorgente autorevole per `year`.
 * @param buildContrib  la funzione `buildContributionParams` del consumer, così
 *            la ricostruzione resta consistente con ciò che il consumer mostra.
 */
export async function loadStoricoPriorSeeds(
  db: Db,
  profileId: string,
  year: number,
  ys: YearSettingsRow,
  buildContrib: BuildContribParams,
): Promise<StoricoPriorSeeds> {
  const loaded = await preload(db, profileId);
  // La riga dell'anno corrente arriva dal consumer (può essere ereditata):
  // ha priorità sull'eventuale riga DB dello stesso anno.
  loaded.ysByYear.set(year, ys);
  const memo = new Map<number, StoricoResult>();
  return seedsFor(loaded, year, buildContrib, memo);
}
