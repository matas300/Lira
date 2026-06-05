// src/server/lib/tax-engine.ts
// Motore fiscale puro: funzioni senza IO, senza Date.now(), senza Math.random().
// Server-authoritative (vedi CLAUDE.md §Architettura) — il client può precalcolare,
// ma la verità fiscale risiede qui.
import { ACCONTO_RULES, type AccontoRules } from '@shared/acconto-rules';
import type { ScheduleFamily } from '@shared/schedule-keys';

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

// --- buildTransitionDiagnostics (Task 12 — port da CalcoliVari) ----------

export interface TransitionInput {
  year: number;
  currentSettings: { regime?: string; haRedditoDipendente?: number };
  previousSettings: { regime?: string; haRedditoDipendente?: number };
}

export interface TransitionInfo {
  year: number;
  currentRegime: string;
  previousRegime: string | null;
  previousHadEmployeeIncome: boolean;
  isRegimeTransition: boolean;
  warnings: string[];
  facts: string[];
}

/**
 * Emette warning diagnostici sulle transizioni di regime e sulla presenza di
 * redditi misti nell'anno precedente. Funzione pura, nessun IO.
 *
 * Port da `CalcoliVari/tax-engine.js:475-507`.
 *
 * Casi gestiti:
 * - `previousHadEmployeeIncome` → lo storico include IRPEF/addizionali non
 *   rappresentativi del forfettario puro.
 * - `isRegimeTransition` → cambio regime tra anno precedente e corrente; gli
 *   acconti storici possono essere prudenziali ma non ottimizzati.
 * - transizione *verso* forfettario da altro regime → consiglio di confrontare
 *   metodo storico e previsionale prima di assumere lo storico come migliore.
 */
export function buildTransitionDiagnostics(input: TransitionInput): TransitionInfo {
  const year = input.year;
  const currentRegime = input.currentSettings.regime ?? 'forfettario';
  const previousRegime = input.previousSettings.regime ?? null;
  const previousHadEmployeeIncome = (input.previousSettings.haRedditoDipendente ?? 0) === 1;
  const isRegimeTransition = !!previousRegime && previousRegime !== currentRegime;

  const warnings: string[] = [];
  const facts: string[] = [];

  if (previousHadEmployeeIncome) {
    warnings.push(
      `Nel ${year - 1} risultano anche redditi da lavoro dipendente: lo storico puo includere IRPEF e addizionali che non rappresentano il forfettario puro del ${year}.`,
    );
    facts.push(`Anno ${year - 1} con redditi misti.`);
  }

  if (isRegimeTransition) {
    warnings.push(
      `Tra ${year - 1} e ${year} c'e una transizione di regime (${previousRegime} -> ${currentRegime}). Gli acconti storici possono essere prudenziali ma non ottimizzati.`,
    );
    facts.push(`Cambio regime ${previousRegime} -> ${currentRegime}.`);
  }

  if (previousRegime && previousRegime !== 'forfettario' && currentRegime === 'forfettario') {
    warnings.push(
      `Lo storico ${year - 1} non e forfettario puro: confronta sempre metodo storico e previsionale prima di assumere che l'acconto storico sia il migliore.`,
    );
  }

  return {
    year,
    currentRegime,
    previousRegime,
    previousHadEmployeeIncome,
    isRegimeTransition,
    warnings,
    facts,
  };
}

// --- buildForfettarioMethodComparison (Task 11 — port da CalcoliVari) ----

export interface ComparisonInput extends ScenarioInput {
  methodSetting: 'storico' | 'previsionale';
  currentSettings?: { regime?: string; haRedditoDipendente?: number };
  previousSettings?: { regime?: string; haRedditoDipendente?: number };
}

export interface ComparisonOutput {
  selectedMethod: 'storico' | 'previsionale';
  selected: ForfettarioScenario;
  historical: ForfettarioScenario;
  previsionale: ForfettarioScenario;
  prudential: 'historical' | 'previsionale';
  liquidity: 'historical' | 'previsionale';
  deltaCash: number;
  transition: TransitionInfo;
  warnings: string[];
}

/**
 * Confronta lo scenario forfettario con metodo `storico` e con metodo
 * `previsionale`, indica quale dei due e prudenziale (maggiore liquidita
 * impegnata) e quale e piu liquido, e aggrega i warning con quelli di
 * `buildTransitionDiagnostics`.
 *
 * Port da `CalcoliVari/tax-engine.js:585-642`.
 *
 * - `selectedMethod` riflette la preferenza utente (`methodSetting`).
 * - `prudential = 'historical'` quando `historical.managedCashOutflows >=
 *   previsionale.managedCashOutflows` (tie-break sul prudenziale).
 * - `liquidity` e sempre l'altro metodo.
 * - `deltaCash = ceil2(historical.managedCashOutflows -
 *   previsionale.managedCashOutflows)` e finisce nel warning solo se
 *   `|deltaCash| >= 0.01`.
 * - Warning aggiuntivo sul confronto fra `taxAcconti.total` dei due metodi.
 */
export function buildForfettarioMethodComparison(input: ComparisonInput): ComparisonOutput {
  const historical = buildForfettarioScenario({ ...input, method: 'storico' });
  const previsionale = buildForfettarioScenario({ ...input, method: 'previsionale' });

  const selectedMethod: 'storico' | 'previsionale' =
    input.methodSetting === 'previsionale' ? 'previsionale' : 'storico';
  const selected = selectedMethod === 'previsionale' ? previsionale : historical;

  const prudentialIsHistorical = historical.managedCashOutflows >= previsionale.managedCashOutflows;
  const prudential: 'historical' | 'previsionale' = prudentialIsHistorical ? 'historical' : 'previsionale';
  const liquidity: 'historical' | 'previsionale' = prudentialIsHistorical ? 'previsionale' : 'historical';

  const deltaCash = ceil2(historical.managedCashOutflows - previsionale.managedCashOutflows);

  const transition = buildTransitionDiagnostics({
    year: input.year,
    currentSettings: input.currentSettings ?? {},
    previousSettings: input.previousSettings ?? {},
  });

  const warnings: string[] = [...transition.warnings];

  if (Math.abs(deltaCash) >= 0.01) {
    warnings.push(
      deltaCash > 0
        ? `Il metodo storico richiede ${deltaCash.toFixed(2)} EUR in piu di liquidita gestita rispetto al previsionale.`
        : `Il metodo previsionale richiede ${Math.abs(deltaCash).toFixed(2)} EUR in piu di liquidita gestita rispetto allo storico.`,
    );
  }

  if (historical.taxAcconti.total > previsionale.taxAcconti.total) {
    warnings.push(
      `Lo storico ti fa anticipare piu imposta sostitutiva del previsionale (${historical.taxAcconti.total.toFixed(2)} vs ${previsionale.taxAcconti.total.toFixed(2)}).`,
    );
  } else if (historical.taxAcconti.total < previsionale.taxAcconti.total) {
    warnings.push(
      `Il previsionale porta acconti imposta piu alti dello storico (${previsionale.taxAcconti.total.toFixed(2)} vs ${historical.taxAcconti.total.toFixed(2)}).`,
    );
  }

  return {
    selectedMethod,
    selected,
    historical,
    previsionale,
    prudential,
    liquidity,
    deltaCash,
    transition,
    warnings,
  };
}

// --- buildInstallmentStatus + buildInstallmentExplanation (Task 13) ------

export interface ScheduleRow {
  id: string;
  family: ScheduleFamily;
  kind: 'tax' | 'contribution' | 'other';
  competence: string;
  title: string;
  method: string;
  amount: number;
  low: number;
  high: number;
  certainty: 'official' | 'estimated' | 'forecast';
  note?: string;
}

export interface InstallmentStatus {
  code: 'paid' | 'underpaid' | 'overpaid' | 'estimated' | 'to_confirm';
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'info';
}

/**
 * Determina lo stato di un installment in base al totale realmente pagato e
 * al range stimato (`low`/`high`) della riga.
 *
 * Port da `CalcoliVari/tax-engine.js:644-655`, con due differenze:
 * - lavora su `paidTotal: number` (somma dei linked payments) invece che su
 *   singolo `linkedPayment`, per allinearsi al modello Lira (più pagamenti
 *   parziali possono insistere sulla stessa rata).
 * - Mantiene la semantica di tono per il rendering UI.
 *
 * Regole:
 * - `paidTotal > 0` → confronto col range `[low, high]` (default `amount` se
 *   non specificati): `underpaid` / `paid` / `overpaid`.
 * - `paidTotal === 0` → `estimated` se la riga ha `certainty === 'estimated'`,
 *   altrimenti `to_confirm`.
 */
export function buildInstallmentStatus(row: ScheduleRow, paidTotal: number): InstallmentStatus {
  if (paidTotal > 0) {
    const paid = ceil2(paidTotal);
    const low = ceil2(row.low ?? row.amount);
    const high = ceil2(row.high ?? row.amount);
    if (paid < low) return { code: 'underpaid', label: 'Sottostimato', tone: 'danger' };
    if (paid > high) return { code: 'overpaid', label: 'Sovrastimato', tone: 'warn' };
    return { code: 'paid', label: 'Pagato', tone: 'ok' };
  }
  if (row.certainty === 'estimated') {
    return { code: 'estimated', label: 'Stimato', tone: 'warn' };
  }
  return { code: 'to_confirm', label: 'Da confermare', tone: 'info' };
}

/**
 * Genera una spiegazione human-readable (IT) per la riga del calendario
 * fiscale. Le regole sono basate sul tipo (`kind`), sulla competence e sul
 * titolo della scadenza.
 *
 * Port da `CalcoliVari/tax-engine.js:657-681`, con adattamento di `kind` da
 * 'tasse'/'contributi' a 'tax'/'contribution' (allineato alle Zod schemas
 * Lira). Fallback finale: `row.note ?? ''`.
 */
export function buildInstallmentExplanation(row: ScheduleRow): string {
  const competence = row.competence;
  const title = row.title;

  if (row.kind === 'tax' && /imposta sostitutiva/i.test(title) && /saldo/i.test(competence)) {
    return `Questo importo chiude l'imposta sostitutiva dell'anno di riferimento indicato (${competence}).`;
  }
  if (row.kind === 'tax' && /imposta sostitutiva/i.test(title) && /acconto/i.test(competence)) {
    return `Questo importo anticipa l'imposta sostitutiva futura ed è calcolato con metodo ${row.method.toLowerCase()}.`;
  }
  if (row.kind === 'contribution' && /rata/i.test(competence)) {
    return 'Questa è una rata fissa INPS artigiani sul minimale.';
  }
  if (row.kind === 'contribution' && /saldo/i.test(competence)) {
    return 'Questo è il saldo della quota contributiva eccedente il minimale.';
  }
  if (row.kind === 'contribution' && /acconto/i.test(competence)) {
    return `Questo importo anticipa i contributi INPS eccedenti del periodo successivo con metodo ${row.method.toLowerCase()}.`;
  }
  if (/camera di commercio/i.test(title)) return 'Diritto annuale camerale dovuto per l\'anno in corso.';
  if (/bollo/i.test(title)) return 'Imposta di bollo sulle fatture elettroniche.';
  if (/inail/i.test(title)) return 'Autoliquidazione INAIL.';
  return row.note ?? '';
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
