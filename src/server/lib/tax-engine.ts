// src/server/lib/tax-engine.ts
// Motore fiscale puro: funzioni senza IO, senza Date.now(), senza Math.random().
// Server-authoritative (vedi CLAUDE.md §Architettura) — il client può precalcolare,
// ma la verità fiscale risiede qui.
import { ACCONTO_RULES, type AccontoRules } from '@shared/acconto-rules';

export interface AccontoPlan {
  base: number;
  total: number;
  first: number;
  second: number;
  mode: 'none' | 'single' | 'double';
}

/**
 * Costruisce il piano acconti secondo art. 17 c. 3 DPR 435/2001.
 *
 * - imposta ≤ 51,65 €  → nessun acconto
 * - imposta ≤ 257,52 € → unico versamento a novembre (100%)
 * - imposta >  257,52 € → due rate (40% giugno + 60% novembre)
 *
 * Le soglie sono in `ACCONTO_RULES` (@shared/acconto-rules) per evitare magic numbers.
 */
export function buildAccontoPlan(baseAmount: number, rules?: AccontoRules): AccontoPlan {
  const cfg = rules ?? ACCONTO_RULES;
  const base = ceil2(baseAmount);

  if (base <= cfg.thresholdZero) {
    return { base, total: 0, first: 0, second: 0, mode: 'none' };
  }

  if (base <= cfg.thresholdSingle) {
    return { base, total: base, first: 0, second: base, mode: 'single' };
  }

  const parts = splitByWeights(base, cfg.weights);
  return {
    base,
    total: base,
    first: parts[0] ?? 0,
    second: parts[1] ?? 0,
    mode: 'double',
  };
}

// --- buildForfettarioScenario (port da CalcoliVari + fix A6) -------------

export interface ContributionParams {
  mode: 'artigiani_commercianti' | 'gestione_separata';
  fixedAnnual: number;
  saldoAccontoBase: number;
}

export interface ScenarioInput {
  year: number;
  method: 'storico' | 'previsionale';
  settings: {
    coefficiente: number;
    impostaSostitutiva: number;
    riduzione35: boolean;
  };
  grossCollected: number;
  currentContribution: ContributionParams;
  previousContribution: ContributionParams;
  previousTaxBase: number;
  previousContributionAccontiPaid: number;
  /** FIX A6: acconti sostitutiva REALMENTE versati (non stimati). */
  accontiSostitutivaPagatiReali: number;
  /** FIX A6: acconti contributi REALMENTE versati (non stimati). */
  accontiContribPagatiReali: number;
  forecastContributionBase?: number;
  forecastTaxBase?: number;
  accontoRules?: AccontoRules;
}

export interface ForfettarioScenario {
  year: number;
  method: 'storico' | 'previsionale';
  grossCollected: number;
  forfettarioGrossIncome: number;
  deductibleContributionsPaid: number;
  taxableBase: number;
  substituteTax: number;
  /** FIX A6: saldo = ceil2(max(substituteTax - accontiSostitutivaPagatiReali, 0)). */
  taxSaldo: number;
  taxAccontoBase: number;
  taxAcconti: AccontoPlan;
  /** FIX A6: saldo contributi = ceil2(max(contribuzioneTotaleAnno - accontiContribPagatiReali, 0)). */
  contributionSaldo: number;
  contributionAccontoBase: number;
  contributionAcconti: AccontoPlan;
  previousFixedTail: number;
  currentFixedWithinYear: number;
  previousContributionSaldo: number;
  managedCashOutflows: number;
  formula: Array<{ label: string; amount: number }>;
  explanation: string[];
}

/**
 * Costruisce uno scenario forfettario completo (reddito lordo → imponibile →
 * sostitutiva → acconti → saldo) per l'anno richiesto.
 *
 * Port da `CalcoliVari/tax-engine.js:509-583` con estensione A6: il saldo della
 * sostitutiva e il saldo contributivo sottraggono gli acconti REALMENTE versati
 * (input `accontiSostitutivaPagatiReali` / `accontiContribPagatiReali`), non quelli
 * stimati dal piano. Questo evita il drift fra preventivo e consuntivo che era
 * uno dei rilievi A6 dell'audit 25/05/2026.
 *
 * Tutte le operazioni passano per `ceil2` per parità con CalcoliVari.
 */
export function buildForfettarioScenario(input: ScenarioInput): ForfettarioScenario {
  const rules = input.accontoRules ?? ACCONTO_RULES;
  const coeff = input.settings.coefficiente;
  const substituteRate = input.settings.impostaSostitutiva;
  const grossCollected = ceil2(input.grossCollected);
  const forfettarioGrossIncome = ceil2(grossCollected * coeff);

  // Split contributi fissi su 4 rate (artigiani: 16/5, 20/8, 16/11, 16/2 anno+1).
  // Per gestione_separata non esiste quota fissa.
  const previousFixedParts = input.previousContribution.mode === 'artigiani_commercianti'
    ? splitByWeights(input.previousContribution.fixedAnnual, [1, 1, 1, 1])
    : [0, 0, 0, 0];
  const currentFixedParts = input.currentContribution.mode === 'artigiani_commercianti'
    ? splitByWeights(input.currentContribution.fixedAnnual, [1, 1, 1, 1])
    : [0, 0, 0, 0];

  // Rata 4 dell'anno scorso (scadenza 16/02 anno corrente) → ricade nell'anno corrente.
  const previousFixedTail = ceil2(previousFixedParts[3] ?? 0);
  // Rate 1-3 anno corrente (maggio + agosto + novembre).
  const currentFixedWithinYear = ceil2(
    (currentFixedParts[0] ?? 0) + (currentFixedParts[1] ?? 0) + (currentFixedParts[2] ?? 0),
  );

  // Saldo eccedente dell'anno scorso (al netto degli acconti contributi già pagati lo scorso anno).
  const previousContributionSaldo = ceil2(
    Math.max(input.previousContribution.saldoAccontoBase - input.previousContributionAccontiPaid, 0),
  );

  // Base acconto contributi (forecast in previsionale, storico altrimenti).
  const contributionAccontoBase = ceil2(
    input.method === 'previsionale'
      ? input.forecastContributionBase ?? 0
      : input.previousContribution.saldoAccontoBase,
  );
  const contributionAcconti = buildAccontoPlan(contributionAccontoBase, rules);

  const deductibleContributionsPaid = ceil2(
    previousFixedTail + currentFixedWithinYear + previousContributionSaldo + contributionAcconti.total,
  );

  const taxableBase = ceil2(Math.max(forfettarioGrossIncome - deductibleContributionsPaid, 0));
  const substituteTax = ceil2(taxableBase * substituteRate);

  // FIX A6: saldo sottrae gli acconti REALMENTE pagati (input dal service), non quelli stimati.
  const taxSaldo = ceil2(Math.max(substituteTax - input.accontiSostitutivaPagatiReali, 0));

  // Base acconto tasse.
  const taxAccontoBase = ceil2(
    input.method === 'previsionale'
      ? input.forecastTaxBase ?? substituteTax
      : input.previousTaxBase,
  );
  const taxAcconti = buildAccontoPlan(taxAccontoBase, rules);

  // FIX A6 contributi: la contribuzione totale anno = quota fissa anno + base variabile,
  // confrontata con acconti reali per produrre il saldo.
  const contribuzioneTotaleAnno = ceil2(
    previousFixedTail + currentFixedWithinYear +
      (input.method === 'previsionale'
        ? input.forecastContributionBase ?? 0
        : input.previousContribution.saldoAccontoBase),
  );
  const contributionSaldo = ceil2(
    Math.max(contribuzioneTotaleAnno - input.accontiContribPagatiReali, 0),
  );

  const managedCashOutflows = ceil2(deductibleContributionsPaid + taxAcconti.total);

  const formula: Array<{ label: string; amount: number }> = [
    { label: 'Ricavi incassati', amount: grossCollected },
    { label: `Reddito lordo forfettario (${ceil2(coeff * 100)}%)`, amount: forfettarioGrossIncome },
    { label: 'Contributi INPS deducibili pagati/stimati nell\'anno', amount: deductibleContributionsPaid },
    { label: 'Imponibile fiscale', amount: taxableBase },
    { label: `Imposta sostitutiva (${ceil2(substituteRate * 100)}%)`, amount: substituteTax },
  ];

  const explanation: string[] = [
    `Parto dagli incassi ${input.year} e applico il coefficiente di redditività ${ceil2(coeff * 100)}%.`,
    `Dalla base forfettaria sottraggo i contributi INPS obbligatori pagati o pianificati nel calendario ${input.year}.`,
    `Sull'imponibile fiscale risultante applico l'imposta sostitutiva del ${ceil2(substituteRate * 100)}%.`,
    input.method === 'previsionale'
      ? 'Questo scenario usa basi previsionali per gli acconti.'
      : 'Questo scenario usa lo storico dell\'anno precedente per gli acconti.',
  ];

  return {
    year: input.year,
    method: input.method,
    grossCollected,
    forfettarioGrossIncome,
    deductibleContributionsPaid,
    taxableBase,
    substituteTax,
    taxSaldo,
    taxAccontoBase,
    taxAcconti,
    contributionSaldo,
    contributionAccontoBase,
    contributionAcconti,
    previousFixedTail,
    currentFixedWithinYear,
    previousContributionSaldo,
    managedCashOutflows,
    formula,
    explanation,
  };
}

// --- Helpers privati (non esportati) -------------------------------------

function ceil2(n: number): number {
  // True ceil to 2 decimals — porta da CalcoliVari/math-utils.js (ceil2).
  // `Number.EPSILON` evita che noise FP (es. 0.30000000000000004) produca un cent in piu`.
  if (!n) return 0;
  return Math.ceil(n * 100 - Number.EPSILON) / 100;
}

/**
 * Divide `amount` per i `weights` proporzionalmente, con compensazione sull'ultima
 * porzione per garantire `sum(parts) === ceil2(amount)` (no rounding loss).
 */
function splitByWeights(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];

  const total = ceil2(amount);
  const sumWeights = weights.reduce((s, w) => s + w, 0);
  if (sumWeights === 0) return weights.map(() => 0);

  const parts: number[] = [];
  let assigned = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (i === weights.length - 1) {
      parts.push(ceil2(total - assigned));
    } else {
      const portion = ceil2((total * w) / sumWeights);
      parts.push(portion);
      assigned = ceil2(assigned + portion);
    }
  }
  return parts;
}
