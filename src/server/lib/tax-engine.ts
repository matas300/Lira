// src/server/lib/tax-engine.ts
// Motore fiscale puro: funzioni senza IO, senza Date.now(), senza Math.random().
// Server-authoritative (vedi CLAUDE.md §Architettura) — il client può precalcolare,
// ma la verità fiscale risiede qui.
import { ACCONTO_RULES, type AccontoRules } from '@shared/acconto-rules';
import { FORFETTARIO_RULES } from '@shared/forfettario-rules';
import {
  getInpsArtComForYear,
  getInpsGsForYear,
  type InpsArtComParams,
  type InpsGsParams,
} from '@shared/inps-params';
import type { ScheduleFamily } from '@shared/schedule-keys';

export interface AccontoPlan {
  base: number;
  total: number;
  first: number;
  second: number;
  mode: 'none' | 'single' | 'double';
}

/**
 * Costruisce il piano acconti dell'IMPOSTA secondo art. 17 c. 3 DPR 435/2001
 * (soglie) + art. 58 DL 124/2019 e Ris. AdE 93/E/2019 (rate 50/50 per i
 * soggetti ISA, forfettari inclusi).
 *
 * - imposta <  51,65 €           → nessun acconto
 * - 51,65 ≤ imposta < 257,52 €   → unico versamento a novembre (100%)
 * - imposta ≥ 257,52 €           → due rate di pari importo (50% + 50%)
 *
 * FIX BOUNDARY (audit): a esattamente 257,52 € il piano è SPLIT (≥, non >).
 *
 * Le soglie valgono per le IMPOSTE: per i contributi variabili usare
 * `buildContributiAccontoPlan` (niente soglie, regole proprie per gestione).
 * Le soglie sono in `ACCONTO_RULES` (@shared/acconto-rules) per evitare magic numbers.
 */
export function buildAccontoPlan(baseAmount: number, rules?: AccontoRules): AccontoPlan {
  const cfg = rules ?? ACCONTO_RULES;
  const base = ceil2(baseAmount);

  if (base < cfg.thresholdZero) {
    return { base, total: 0, first: 0, second: 0, mode: 'none' };
  }

  if (base < cfg.thresholdSingle) {
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

// Acconto Gestione Separata: 80% del dovuto presunto, versato in due rate
// del 40% ciascuna alle scadenze delle imposte (art. 18 c. 4 D.Lgs. 241/1997;
// per i professionisti GS la misura dell'acconto è l'80% — L. 449/1997 art.
// 59 c. 16 e prassi INPS annuale).
const GS_ACCONTO_RATA = 0.4;
const GS_ACCONTO_TOTALE = 0.8;

/**
 * Costruisce il piano acconti dei CONTRIBUTI VARIABILI. Le soglie 51,65 /
 * 257,52 dell'art. 17 c. 3 DPR 435/2001 valgono SOLO per le imposte e qui
 * NON si applicano (fix audit: piano contributivo separato).
 *
 * - Artigiani/commercianti: due rate di pari importo (50% + 50%) alle
 *   scadenze delle imposte (30/06 e 30/11), senza soglie minime.
 * - Gestione Separata: acconto complessivo = 80% del dovuto presunto, in
 *   due rate del 40% ciascuna (`total = 80% base`, `first = second = 40%`).
 *
 * `base` nel piano restituito è sempre il dovuto presunto di riferimento
 * (per GS quindi `total < base` by design).
 */
export function buildContributiAccontoPlan(
  baseAmount: number,
  gestione: 'artigiani_commercianti' | 'gestione_separata',
): AccontoPlan {
  const base = ceil2(baseAmount);
  if (base <= 0) {
    return { base: Math.max(base, 0), total: 0, first: 0, second: 0, mode: 'none' };
  }

  if (gestione === 'gestione_separata') {
    const first = ceil2(base * GS_ACCONTO_RATA);
    const total = ceil2(base * GS_ACCONTO_TOTALE);
    const second = ceil2(total - first);
    return { base, total, first, second, mode: 'double' };
  }

  const parts = splitByWeights(base, [50, 50]);
  return {
    base,
    total: base,
    first: parts[0] ?? 0,
    second: parts[1] ?? 0,
    mode: 'double',
  };
}

// --- Contributi INPS variabili (fix audit: quota variabile mai calcolata) --

/**
 * Quota variabile INPS Artigiani/Commercianti sul reddito eccedente il
 * minimale (Circolare INPS annuale; base = reddito forfettario LORDO,
 * ricavi × coefficiente, ANTE deduzione dei contributi — Circ. INPS 35/2016).
 *
 * - Prima fascia: aliquota base (24% artigiani / 24,48% commercianti) sulla
 *   parte di reddito fra minimale e fascia di maggiorazione.
 * - Seconda fascia (art. 3-ter DL 384/1992 conv. L. 438/1992): aliquota +1
 *   p.p. (25% / 25,48%) sulla parte oltre la fascia, fino al massimale.
 * - Riduzione 35% (art. 1 c. 77 L. 190/2014): si applica ANCHE alla quota
 *   variabile (× 0,65), come per la quota fissa.
 */
export function calcContributiVariabiliArtCom(args: {
  redditoLordo: number;
  params: InpsArtComParams;
  categoria: 'artigiano' | 'commerciante';
  riduzione35: boolean;
}): number {
  const { redditoLordo, params, categoria, riduzione35 } = args;
  const aliquotaBase =
    categoria === 'commerciante' ? params.aliquotaCommerciante : params.aliquotaArtigiano;
  const aliquotaOltre =
    categoria === 'commerciante'
      ? params.aliquotaCommercianteOltreFascia
      : params.aliquotaArtigianoOltreFascia;

  // Reddito rilevante: clampato fra 0 e massimale.
  const reddito = Math.min(Math.max(redditoLordo, 0), params.massimale);
  const primaFascia = Math.max(
    Math.min(reddito, params.fasciaRedditoAliquotaMaggiorata) - params.minimaleAnnuo,
    0,
  );
  const secondaFascia = Math.max(reddito - params.fasciaRedditoAliquotaMaggiorata, 0);

  const pieno = aliquotaBase * primaFascia + aliquotaOltre * secondaFascia;
  const conRiduzione = riduzione35 ? pieno * FORFETTARIO_RULES.riduzioneInpsCoefficiente : pieno;
  return ceil2(conRiduzione);
}

/**
 * Contributo INPS Gestione Separata (L. 335/1995 art. 2 c. 26): proporzionale
 * sul reddito forfettario LORDO (ante deduzione contributi, Circ. INPS
 * 35/2016), senza minimale, capped al massimale. Niente quota fissa e
 * niente riduzione 35% (l'art. 1 c. 77 L. 190/2014 riguarda solo IVS
 * artigiani/commercianti).
 */
export function calcContributiVariabiliGs(args: {
  redditoLordo: number;
  params: InpsGsParams;
  altraCassa: boolean;
}): number {
  const { redditoLordo, params, altraCassa } = args;
  const aliquota = altraCassa ? params.aliquotaConAltraCassa : params.aliquotaSenzaAltraCassa;
  const base = Math.min(Math.max(redditoLordo, 0), params.massimale);
  return ceil2(aliquota * base);
}

/**
 * Risolve i parametri INPS dell'anno e calcola i contributi variabili per la
 * gestione indicata. Se l'anno non è ancora pubblicato nelle tabelle
 * (`getInps*ForYear` solleva), ritorna 0 — stessa convenzione "graceful" di
 * scadenziario-engine per la quota fissa: il service espone già un warning
 * per gli anni senza parametri.
 */
function calcContributiVariabiliAnno(
  year: number,
  redditoLordo: number,
  contribution: ContributionParams,
  riduzione35: boolean,
): number {
  if (contribution.mode === 'gestione_separata') {
    let params: InpsGsParams | null = null;
    try {
      params = getInpsGsForYear(year);
    } catch {
      params = null;
    }
    if (!params) return 0;
    return calcContributiVariabiliGs({
      redditoLordo,
      params,
      altraCassa: contribution.altraCassa ?? false,
    });
  }
  let params: InpsArtComParams | null = null;
  try {
    params = getInpsArtComForYear(year);
  } catch {
    params = null;
  }
  if (!params) return 0;
  return calcContributiVariabiliArtCom({
    redditoLordo,
    params,
    categoria: contribution.categoria ?? 'artigiano',
    riduzione35,
  });
}

// --- buildForfettarioScenario (port da CalcoliVari + fix A6) -------------

export interface ContributionParams {
  mode: 'artigiani_commercianti' | 'gestione_separata';
  fixedAnnual: number;
  /**
   * Contributi VARIABILI dovuti per l'anno di competenza di questo record
   * (per `previousContribution` = variabile dovuta per l'anno precedente):
   * è la base del piano acconti contributivo col metodo storico.
   */
  saldoAccontoBase: number;
  /**
   * Solo art/com: seleziona l'aliquota della quota variabile (24% artigiano
   * / 24,48% commerciante, +1 p.p. oltre fascia). Default: 'artigiano'.
   */
  categoria?: 'artigiano' | 'commerciante';
  /**
   * Solo gestione separata: `true` se iscritto anche ad altra cassa /
   * pensionato → aliquota 24% invece di 26,07%. Default: false.
   */
  altraCassa?: boolean;
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
  /**
   * METODO PREVISIONALE (fix audit unità di misura): RICAVI LORDI PREVISTI
   * per l'anno corrente (stessa unità di `grossCollected`, NON un'imposta
   * né una base contributiva). L'engine vi applica internamente coefficiente,
   * deduzione contributi, aliquota sostitutiva e regole INPS per derivare
   * imposta prevista e contributi variabili previsti (stesse regole del
   * consuntivo). Se omesso, fallback a `grossCollected`.
   */
  forecastGrossCollected?: number;
  /**
   * Contributi INPS EFFETTIVAMENTE VERSATI nell'anno (principio di cassa,
   * art. 1 c. 64 L. 190/2014). Se fornito (anche 0), sostituisce la stima
   * da piano (rate fisse + saldo precedente + acconti pianificati) nella
   * deduzione dal reddito forfettario. Se `undefined`/`null`, fallback al
   * piano come in precedenza.
   */
  contributiVersatiAnno?: number | null;
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
  /**
   * Acconti sostitutiva REALMENTE versati (echo dell'input): serve alla
   * dichiarazione per LM45 (acconti versati) SENZA cap all'imposta, così un
   * sovra-acconto (acconti > imposta) genera correttamente un credito LM47/
   * RX31 col.5 invece di sparire (fix A6).
   */
  accontiSostitutivaPagatiReali: number;
  taxAccontoBase: number;
  taxAcconti: AccontoPlan;
  /**
   * Contributi VARIABILI dovuti per l'anno (competenza N): quota eccedente
   * il minimale art/com (con seconda fascia e cap massimale) oppure
   * contributo proporzionale GS. Base = reddito forfettario LORDO (Circ.
   * INPS 35/2016). Va a saldo il 30/6 N+1 insieme alle imposte e genera gli
   * acconti N+1.
   */
  contributiVariabiliDovuti: number;
  /** FIX A6: saldo contributi variabili = ceil2(max(contributiVariabiliDovuti - accontiContribPagatiReali, 0)). */
  contributionSaldo: number;
  contributionAccontoBase: number;
  contributionAcconti: AccontoPlan;
  /** Ricavi previsti usati per il metodo previsionale (echo input o fallback a grossCollected). */
  forecastGrossCollected: number;
  /** Reddito forfettario lordo previsto = ceil2(forecastGrossCollected × coefficiente). */
  forecastGrossIncome: number;
  /** Contributi variabili previsti sul reddito previsto (stesse regole del consuntivo). */
  forecastContributiVariabili: number;
  /** Imponibile previsto = max(forecastGrossIncome - deductibleContributionsPaid, 0). */
  forecastTaxableBase: number;
  /** Imposta sostitutiva prevista — base del piano acconti col metodo previsionale. */
  forecastSubstituteTax: number;
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
 * Fix audit (giugno 2026) incorporati qui:
 * - **Contributi variabili calcolati**: `contributiVariabiliDovuti` = quota
 *   eccedente il minimale art/com (con seconda fascia e cap massimale) o
 *   proporzionale GS, su reddito forfettario LORDO (Circ. INPS 35/2016).
 *   Va a saldo il 30/6 N+1 e genera gli acconti N+1.
 * - **Previsionale in ricavi**: il metodo previsionale riceve
 *   `forecastGrossCollected` (RICAVI previsti) e deriva internamente imposta
 *   e contributi previsti con le stesse regole del consuntivo.
 * - **Piano acconti contributivo separato**: `buildContributiAccontoPlan`
 *   (50/50 art/com senza soglie; 80% in due rate 40% per GS) al posto delle
 *   soglie imposta dell'art. 17 c. 3 DPR 435/2001.
 * - **Deduzione per cassa**: se `contributiVersatiAnno` è fornito, la
 *   deduzione usa i versamenti effettivi (art. 1 c. 64 L. 190/2014) invece
 *   del piano.
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

  // Contributi variabili dovuti per l'anno N (competenza): base = reddito
  // forfettario LORDO, ante deduzione contributi (Circ. INPS 35/2016).
  const contributiVariabiliDovuti = calcContributiVariabiliAnno(
    input.year,
    forfettarioGrossIncome,
    input.currentContribution,
    input.settings.riduzione35,
  );

  // Metodo previsionale: ricavi previsti → reddito lordo previsto →
  // contributi variabili previsti, con gli stessi parametri dell'anno N.
  const forecastGrossCollected = ceil2(input.forecastGrossCollected ?? input.grossCollected);
  const forecastGrossIncome = ceil2(forecastGrossCollected * coeff);
  const forecastContributiVariabili = calcContributiVariabiliAnno(
    input.year,
    forecastGrossIncome,
    input.currentContribution,
    input.settings.riduzione35,
  );

  // Saldo eccedente dell'anno scorso (al netto degli acconti contributi già pagati lo scorso anno).
  const previousContributionSaldo = ceil2(
    Math.max(input.previousContribution.saldoAccontoBase - input.previousContributionAccontiPaid, 0),
  );

  // Base acconto contributi: storico = variabile dovuta per l'anno scorso;
  // previsionale = variabile prevista per l'anno corrente. Piano dedicato
  // SENZA le soglie imposta (fix audit: piano contributivo separato).
  const contributionAccontoBase = ceil2(
    input.method === 'previsionale'
      ? forecastContributiVariabili
      : input.previousContribution.saldoAccontoBase,
  );
  const contributionAcconti = buildContributiAccontoPlan(
    contributionAccontoBase,
    input.currentContribution.mode,
  );

  // Deduzione contributi (principio di cassa, art. 1 c. 64 L. 190/2014):
  // versamenti EFFETTIVI se forniti dal service, altrimenti stima da piano.
  const deductibleContributionsPaid =
    input.contributiVersatiAnno != null
      ? ceil2(Math.max(input.contributiVersatiAnno, 0))
      : ceil2(
          previousFixedTail + currentFixedWithinYear + previousContributionSaldo + contributionAcconti.total,
        );

  const taxableBase = ceil2(Math.max(forfettarioGrossIncome - deductibleContributionsPaid, 0));
  const substituteTax = ceil2(taxableBase * substituteRate);

  // FIX A6: saldo sottrae gli acconti REALMENTE pagati (input dal service), non quelli stimati.
  const taxSaldo = ceil2(Math.max(substituteTax - input.accontiSostitutivaPagatiReali, 0));

  // Imposta prevista: stesse regole del consuntivo (deduzione contributi
  // inclusa — i versamenti dell'anno non cambiano col reddito previsto).
  const forecastTaxableBase = ceil2(Math.max(forecastGrossIncome - deductibleContributionsPaid, 0));
  const forecastSubstituteTax = ceil2(forecastTaxableBase * substituteRate);

  // Base acconto tasse: storico = imposta anno scorso; previsionale =
  // imposta prevista calcolata internamente sui ricavi previsti.
  const taxAccontoBase = ceil2(
    input.method === 'previsionale' ? forecastSubstituteTax : input.previousTaxBase,
  );
  const taxAcconti = buildAccontoPlan(taxAccontoBase, rules);

  // FIX A6 + fix variabile: il saldo contributivo è simmetrico al saldo
  // imposta — contributi variabili dovuti per l'anno meno acconti REALMENTE
  // versati. Le quote fisse NON entrano nel saldo: hanno le proprie 4 rate
  // dedicate nel calendario (inps_fissi_1..4).
  const contributionSaldo = ceil2(
    Math.max(contributiVariabiliDovuti - input.accontiContribPagatiReali, 0),
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
    `Sul reddito forfettario lordo (ante deduzione contributi) calcolo i contributi INPS variabili dovuti per l'anno: ${contributiVariabiliDovuti.toFixed(2)} EUR (saldo al 30/6 dell'anno successivo).`,
    input.method === 'previsionale'
      ? 'Questo scenario usa basi previsionali per gli acconti (ricavi previsti, stesse regole del consuntivo).'
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
    accontiSostitutivaPagatiReali: ceil2(Math.max(input.accontiSostitutivaPagatiReali, 0)),
    taxAccontoBase,
    taxAcconti,
    contributiVariabiliDovuti,
    contributionSaldo,
    contributionAccontoBase,
    contributionAcconti,
    forecastGrossCollected,
    forecastGrossIncome,
    forecastContributiVariabili,
    forecastTaxableBase,
    forecastSubstituteTax,
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

// --- Helpers numerici -----------------------------------------------------

/**
 * True ceil a 2 decimali, FP-safe (fix audit: la versione precedente usava
 * `Number.EPSILON`, che è un epsilon ASSOLUTO efficace solo per n ≲ 2 — per
 * importi reali `ceil2(4460.64)` dava 4460.65 e `splitByWeights` produceva
 * rate disuguali).
 *
 * Strategia: si lavora su millesimi interi. `Math.round(n * 1000)` assorbe il
 * noise IEEE 754 (es. 4460.6400000000003 → 4460640); il ceil è poi applicato
 * sui decimi di centesimo, preservando la semantica "ceil vero" per i valori
 * con terza cifra decimale reale (es. 724.854 → 724.86).
 */
export function ceil2(n: number): number {
  if (!n) return 0;
  return Math.ceil(Math.round(n * 1000) / 10) / 100;
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
