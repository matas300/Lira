// src/server/lib/scadenziario-engine.ts
//
// Motore puro che assembla il calendario fiscale forfettario dell'anno N:
// 13 righe (3 sostitutiva + 3 contributi variabili + 4 INPS fissi + 2 bollo
// + 1 camera commercio; INAIL omessa in 2A) con date, importi, certainty,
// payment linkage, status e explanation.
//
// Pure function: nessuna lettura di Date.now(), nessun accesso a IO. Tutti
// gli input arrivano via `ScadenziarioInput` (gli scenari forfettari, i
// pagamenti aggregati per chiave, i parametri annuali). Il "today" non
// serve qui — lo stato "scaduto/aperto" è derivato dal service, che ha
// accesso al clock reale.
//
// Fix risolti by-design:
// - **A5** (proroga propagation): quando `yearSettings.prorogaSaldoAt` è
//   valorizzata, la data si propaga su saldo + 1° acconto sostitutiva +
//   saldo + 1° acconto contributi + camera. acc2 (30/11), INPS fissi e
//   bollo NON sono toccati. Un warning `A5_PROROGA_APPLICATA` di severity
//   `info` viene aggiunto agli output `warnings[]`. Questo evita il bug
//   storico di CalcoliVari (proroga applicata a tappeto a tutte le righe
//   o, peggio, dimenticata su qualcuna).
// - **C3** (slittamento uniforme): tutte le date di scadenza che non
//   passano dalla proroga vanno attraverso `buildRolledDueDate` (da
//   `@shared/date-rules`). Niente codepath che bypassa il rolling, inclusi
//   28/02 (bollo Q4 e INPS fissi rata 4 dell'anno precedente).
//
// Riusa `buildInstallmentStatus` e `buildInstallmentExplanation` dal
// tax-engine: il contratto `ScheduleRow` di tax-engine è una proiezione
// flat (`amount` scalare, niente proroga) della `ScadenziarioRow` qui
// definita; quando chiamiamo i due helper costruiamo l'adapter on the fly.

import {
  buildInstallmentExplanation,
  buildInstallmentStatus,
  ceil2,
  type ForfettarioScenario,
  type InstallmentStatus,
  type ScheduleRow as TaxScheduleRow,
} from './tax-engine';
import { buildScheduleKey, type ScheduleFamily } from '@shared/schedule-keys';
import { buildRolledDueDate } from '@shared/date-rules';
import { FORFETTARIO_RULES } from '@shared/forfettario-rules';
import { getInpsArtComForYear } from '@shared/inps-params';
import type { AuditWarning } from '@shared/audit-checks';

// --- Public surface -----------------------------------------------------

export interface PaymentBreakdown {
  id: string;
  data: string;
  importo: number;
  /**
   * `pure`: il pagamento è interamente imputato a questa schedule key.
   * `mixed`: il pagamento copre più chiavi (linkedKeys breakdown); l'importo
   * qui è la quota imputata a questa riga.
   */
  mode: 'pure' | 'mixed';
}

export interface ScadenziarioInput {
  year: number;
  yearSettings: {
    regime: string;
    coefficiente: number;
    impostaSostitutiva: number;
    inpsMode: 'artigiani_commercianti' | 'gestione_separata';
    inpsCategoria: string | null;
    riduzione_35: number;
    riduzione_35_comunicata: number;
    haRedditoDipendente: number;
    scadenziarioMetodo: 'storico' | 'previsionale';
    prorogaSaldoAt: string | null;
  };
  previousYearSettings: ScadenziarioInput['yearSettings'] | null;
  scenarios: { historical: ForfettarioScenario; previsionale: ForfettarioScenario };
  paymentsByKey: Map<string, { paidTotal: number; payments: PaymentBreakdown[] }>;
  bolloByQuarter: { q123: number; q4: number };
  cameraCommerce: number;
}

export interface ScadenziarioRow {
  id: string;
  title: string;
  family: ScheduleFamily;
  kind: 'tax' | 'contribution';
  competenceYear: number;
  /** Data effettiva (post-proroga o post-rolling). */
  dueDate: string;
  /** Data canonica prima di rolling/proroga. */
  dueDateOriginal: string;
  /** True se `buildRolledDueDate` ha shiftato la data per weekend/festivo. */
  dueDateRolled: boolean;
  /** True se la riga ha ricevuto la proroga del saldo (fix A5). */
  prorogaApplied: boolean;
  amount: { low: number; high: number; point: number };
  certainty: 'official' | 'estimated' | 'forecast';
  payments: PaymentBreakdown[];
  paidTotal: number;
  status: InstallmentStatus;
  explanation: string;
}

export interface ScadenziarioOutput {
  year: number;
  method: 'storico' | 'previsionale';
  rows: ScadenziarioRow[];
  summary: {
    totalDue: number;
    totalPaid: number;
    totalResidual: number;
    nextDue: ScadenziarioRow | null;
  };
  warnings: AuditWarning[];
}

// --- Internal --------------------------------------------------------------

/**
 * Famiglie il cui dueDate base 30/06/N può essere prorogato dalla
 * `prorogaSaldoAt`. Fix A5: lista esplicita e nominale, niente "tutte le
 * righe che cadono il 30/06" — il `prorogaApplied=true` deve dipendere
 * dalla semantica della riga, non solo dalla data calendaria.
 */
const PROROGABILI_FAMILIES: ReadonlySet<ScheduleFamily> = new Set<ScheduleFamily>([
  'imposta_saldo',
  'imposta_acc1',
  'contributi_saldo',
  'contributi_acc1',
  'camera',
]);

interface RowSeed {
  family: ScheduleFamily;
  competenceYear: number;
  /** Data canonica PRE-rolling (es. `${year}-06-30`). */
  dueDateBase: string;
  title: string;
  kind: 'tax' | 'contribution';
  amount: { low: number; high: number; point: number };
  certainty: 'official' | 'estimated' | 'forecast';
}

function fixedPoint(v: number): { low: number; high: number; point: number } {
  return { low: v, high: v, point: v };
}

/**
 * Costruisce il vettore di 13 seed per l'anno N. Le date sono ancora
 * canoniche (pre-rolling/proroga) — verranno trasformate in `dueDate` da
 * `buildScadenziario`.
 *
 * INPS quota fissa: artigiani/commercianti hanno 4 rate uguali; gestione
 * separata non ha quote fisse (rataFissa = 0). Se l'anno non è in
 * `INPS_ARTCOM` (es. 2026 non ancora pubblicato), la rata cade a 0 senza
 * sollevare: il service espone già un warning specifico altrove.
 */
function buildSeeds(input: ScadenziarioInput): RowSeed[] {
  const { year, yearSettings } = input;
  const method = yearSettings.scadenziarioMetodo;
  const scenario =
    method === 'previsionale' ? input.scenarios.previsionale : input.scenarios.historical;

  // INPS quota fissa per rata (4 rate uguali). Solo art/com.
  let rataFissa = 0;
  if (yearSettings.inpsMode === 'artigiani_commercianti') {
    let params: { quotaFissaAnnuaArtigiano: number; quotaFissaAnnuaCommerciante: number } | null = null;
    try {
      params = getInpsArtComForYear(year);
    } catch {
      params = null;
    }
    if (params) {
      const quotaFissa =
        yearSettings.inpsCategoria === 'commerciante'
          ? params.quotaFissaAnnuaCommerciante
          : params.quotaFissaAnnuaArtigiano;
      const riduzione =
        yearSettings.riduzione_35 === 1 ? FORFETTARIO_RULES.riduzioneInpsCoefficiente : 1;
      // Fix audit: arrotonda a 2 decimali (FP-safe) — con riduzione 35% la
      // divisione per 4 produce millesimi (es. 4460.64 × 0.65 / 4 = 724.854
      // → 724.86), che non sono importi F24 validi.
      rataFissa = ceil2((quotaFissa * riduzione) / 4);
    }
  }

  const certaintyTax: 'estimated' | 'forecast' =
    method === 'previsionale' ? 'forecast' : 'estimated';

  const seeds: RowSeed[] = [
    // Imposta sostitutiva — saldo (N-1) + 2 acconti (N).
    {
      family: 'imposta_saldo',
      competenceYear: year - 1,
      dueDateBase: `${year}-06-30`,
      title: 'Imposta sostitutiva — saldo',
      kind: 'tax',
      amount: fixedPoint(scenario.taxSaldo),
      certainty: certaintyTax,
    },
    {
      family: 'imposta_acc1',
      competenceYear: year,
      dueDateBase: `${year}-06-30`,
      title: 'Imposta sostitutiva — acconto 1',
      kind: 'tax',
      amount: fixedPoint(scenario.taxAcconti.first),
      certainty: certaintyTax,
    },
    {
      family: 'imposta_acc2',
      competenceYear: year,
      dueDateBase: `${year}-11-30`,
      title: 'Imposta sostitutiva — acconto 2',
      kind: 'tax',
      amount: fixedPoint(scenario.taxAcconti.second),
      certainty: certaintyTax,
    },

    // Contributi variabili INPS (eccedente minimale) — saldo + 2 acconti.
    {
      family: 'contributi_saldo',
      competenceYear: year - 1,
      dueDateBase: `${year}-06-30`,
      title: 'INPS variabile — saldo',
      kind: 'contribution',
      amount: fixedPoint(scenario.contributionSaldo),
      certainty: certaintyTax,
    },
    {
      family: 'contributi_acc1',
      competenceYear: year,
      dueDateBase: `${year}-06-30`,
      title: 'INPS variabile — acconto 1',
      kind: 'contribution',
      amount: fixedPoint(scenario.contributionAcconti.first),
      certainty: certaintyTax,
    },
    {
      family: 'contributi_acc2',
      competenceYear: year,
      dueDateBase: `${year}-11-30`,
      title: 'INPS variabile — acconto 2',
      kind: 'contribution',
      amount: fixedPoint(scenario.contributionAcconti.second),
      certainty: certaintyTax,
    },

    // INPS quote fisse — 4 rate (16/05, 20/08, 16/11, 16/02 N+1).
    // Competenza sempre N (anche rata 4 che cade fisicamente N+1).
    {
      family: 'inps_fissi_1',
      competenceYear: year,
      dueDateBase: `${year}-05-16`,
      title: 'INPS fissi — rata 1',
      kind: 'contribution',
      amount: fixedPoint(rataFissa),
      certainty: 'official',
    },
    {
      family: 'inps_fissi_2',
      competenceYear: year,
      dueDateBase: `${year}-08-20`,
      title: 'INPS fissi — rata 2',
      kind: 'contribution',
      amount: fixedPoint(rataFissa),
      certainty: 'official',
    },
    {
      family: 'inps_fissi_3',
      competenceYear: year,
      dueDateBase: `${year}-11-16`,
      title: 'INPS fissi — rata 3',
      kind: 'contribution',
      amount: fixedPoint(rataFissa),
      certainty: 'official',
    },
    {
      family: 'inps_fissi_4',
      competenceYear: year,
      dueDateBase: `${year + 1}-02-16`,
      title: 'INPS fissi — rata 4',
      kind: 'contribution',
      amount: fixedPoint(rataFissa),
      certainty: 'official',
    },

    // Bollo fattura elettronica.
    {
      family: 'bollo_q123',
      competenceYear: year,
      dueDateBase: `${year}-09-30`,
      title: 'Imposta di bollo — Q1+Q2+Q3',
      kind: 'tax',
      amount: fixedPoint(input.bolloByQuarter.q123),
      certainty: 'official',
    },
    {
      family: 'bollo_q4',
      competenceYear: year,
      dueDateBase: `${year + 1}-02-28`,
      title: 'Imposta di bollo — Q4',
      kind: 'tax',
      amount: fixedPoint(input.bolloByQuarter.q4),
      certainty: 'official',
    },

    // Diritto camerale — competenza N-1, versamento 30/06/N (prorogabile A5).
    {
      family: 'camera',
      competenceYear: year - 1,
      dueDateBase: `${year}-06-30`,
      title: 'Diritto camerale',
      kind: 'tax',
      amount: fixedPoint(input.cameraCommerce),
      certainty: 'official',
    },
  ];

  return seeds;
}

/**
 * Mappa il `ScadenziarioRow` di slice 2A nel contratto piatto `ScheduleRow`
 * che `buildInstallmentStatus`/`buildInstallmentExplanation` accettano. Le
 * regole di explanation del tax-engine sono basate su regex su `title` e
 * `competence`: usiamo il titolo per entrambi (il titolo della seed contiene
 * già parole come "saldo"/"acconto 1"/"acconto 2"/"Q4" per il pattern match).
 */
function toTaxScheduleRow(
  seed: RowSeed,
  id: string,
  method: 'storico' | 'previsionale',
): TaxScheduleRow {
  return {
    id,
    family: seed.family,
    // tax-engine.ScheduleRow ammette 'other' oltre tax/contribution: qui
    // facciamo passare il kind originale (tax o contribution) invariato.
    kind: seed.kind,
    competence: seed.title,
    title: seed.title,
    method: method === 'previsionale' ? 'Previsionale' : 'Storico',
    amount: seed.amount.point,
    low: seed.amount.low,
    high: seed.amount.high,
    certainty: seed.certainty,
  };
}

/**
 * Decide la `dueDate` effettiva di una riga + i flag `dueDateRolled` e
 * `prorogaApplied`. Logica:
 * - se la `prorogaSaldoAt` è valorizzata E la famiglia è in `PROROGABILI`
 *   E la data canonica è `${year}-06-30` → uso la proroga (no rolling: la
 *   proroga è già una data legalmente scelta dall'utente).
 * - altrimenti → `buildRolledDueDate` (fix C3 uniforme).
 */
function resolveDueDate(
  seed: RowSeed,
  prorogaSaldoAt: string | null,
): { dueDate: string; dueDateRolled: boolean; prorogaApplied: boolean } {
  if (
    prorogaSaldoAt &&
    PROROGABILI_FAMILIES.has(seed.family) &&
    /-06-30$/.test(seed.dueDateBase)
  ) {
    return { dueDate: prorogaSaldoAt, dueDateRolled: false, prorogaApplied: true };
  }
  const rolled = buildRolledDueDate(seed.dueDateBase);
  return { dueDate: rolled.date, dueDateRolled: rolled.rolled, prorogaApplied: false };
}

// --- Public function -------------------------------------------------------

/**
 * Costruisce lo scadenziario fiscale forfettario per l'anno richiesto. Pure
 * function: ricomputabile a piacere dal service o dal frontend mock.
 *
 * Output:
 * - `rows`: 13 righe, ordine canonico (saldo/acc1/acc2 sostitutiva, idem
 *   contributi variabili, 4 fissi INPS, 2 bollo, 1 camera).
 * - `summary.nextDue`: prima riga non ancora interamente pagata ordinata
 *   per `dueDate` ascendente.
 * - `warnings`: include solo i warning derivati dallo scheduling (al
 *   momento solo `A5_PROROGA_APPLICATA`). Altri warning (C1, A1, M1, ...)
 *   sono aggiunti dal service che chiama `evaluateAuditChecks`.
 */
export function buildScadenziario(input: ScadenziarioInput): ScadenziarioOutput {
  const method = input.yearSettings.scadenziarioMetodo;
  const prorogaSaldoAt = input.yearSettings.prorogaSaldoAt;
  const seeds = buildSeeds(input);

  const rows: ScadenziarioRow[] = seeds.map((seed) => {
    const id = buildScheduleKey(seed.family, seed.competenceYear);
    const { dueDate, dueDateRolled, prorogaApplied } = resolveDueDate(seed, prorogaSaldoAt);
    const pay = input.paymentsByKey.get(id) ?? { paidTotal: 0, payments: [] };
    const taxRow = toTaxScheduleRow(seed, id, method);

    return {
      id,
      title: seed.title,
      family: seed.family,
      kind: seed.kind,
      competenceYear: seed.competenceYear,
      dueDate,
      dueDateOriginal: seed.dueDateBase,
      dueDateRolled,
      prorogaApplied,
      amount: seed.amount,
      certainty: seed.certainty,
      payments: pay.payments,
      paidTotal: pay.paidTotal,
      status: buildInstallmentStatus(taxRow, pay.paidTotal),
      explanation: buildInstallmentExplanation(taxRow),
    };
  });

  const warnings: AuditWarning[] = [];
  if (prorogaSaldoAt) {
    warnings.push({
      code: 'A5_PROROGA_APPLICATA',
      severity: 'info',
      title: 'Proroga saldo applicata',
      message: `Saldo e primo acconto di sostitutiva e contributi, e diritto camerale, sono prorogati al ${prorogaSaldoAt}.`,
      context: { prorogaSaldoAt },
    });
  }

  // nextDue: prima riga non-paid in ordine cronologico di dueDate.
  // Ordine ISO è lex-compatibile con quello calendariale.
  const sortedByDate = rows.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextDue = sortedByDate.find((r) => r.status.code !== 'paid') ?? null;

  const totalDue = rows.reduce((s, r) => s + r.amount.point, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paidTotal, 0);
  const totalResidual = Math.max(totalDue - totalPaid, 0);

  return {
    year: input.year,
    method,
    rows,
    summary: { totalDue, totalPaid, totalResidual, nextDue },
    warnings,
  };
}
