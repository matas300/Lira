// src/test-fixtures/mattia-2025.ts
// Golden fixture: profilo Mattia, anno d'imposta 2025.
//
// Forma "self-anchoring" (vedi golden-regression.test.ts): l'input qui sotto
// rispecchia le caratteristiche reali del contribuente (forfettario, ATECO
// 62.10.00 programmazione → coeff 67%, sostitutiva 15%, INPS artigiani,
// NESSUNA riduzione 35%, data inizio attività 2018-04-01 quindi NON startup).
//
// I numeri in `expected` NON sono snapshot dell'output del motore: sono stati
// RICALCOLATI A MANO (audit giugno 2026) con le fonti normative citate sotto,
// e fungono da ancora di regressione INDIPENDENTE. Qualsiasi modifica al
// tax-engine che li alteri romperà il golden test e forzerà una verifica
// fiscale esplicita, non una semplice ricalibrazione da output.
//
// ── CALCOLO MANUALE PASSO-PASSO ─────────────────────────────────────────────
//
// Parametri INPS Artigiani 2025 (Circolare INPS 38/2025):
//   minimale            = 18.555,00
//   quota fissa annua   =  4.460,64   (= 18.555 × 24% + 7,44 maternità)
//   aliquota variabile  = 24%  (25% oltre fascia 55.448 — qui non raggiunta)
//   massimale           = 120.607,00  (qui non raggiunto)
//
// 1. Reddito forfettario lordo (art. 1 c. 64 L. 190/2014):
//      45.000 × 0,67 = 30.150,00
//
// 2. Contributi variabili dovuti 2025 (Circ. INPS 35/2016: base = reddito
//    LORDO, ante deduzione contributi; nessuna riduzione 35%):
//      24% × (30.150 − 18.555) = 24% × 11.595 = 2.782,80
//    → vanno a saldo il 30/6/2026 e generano gli acconti 2026.
//
// 3. Contributi VERSATI (pianificati) nel 2025, deducibili per cassa
//    (art. 1 c. 64 L. 190/2014). Nel fixture saldoAccontoBase prec = 0
//    (nessuna eccedenza 2024 dichiarata) e nessun acconto contributivo:
//      rata 4 fissi 2024 (16/02/2025)  = 4.460,64 / 4 = 1.115,16
//      rate 1-3 fissi 2025             = 3 × 1.115,16 = 3.345,48
//      saldo variabile 2024            = 0   (saldoAccontoBase prec = 0)
//      acconti variabili 2025          = 0   (base storico = 0 → piano none)
//      TOTALE deducibile               = 4.460,64
//    NB: il runner usa la quota fissa 2025 anche per la rata 4 "2024" —
//    approssimazione del fixture, accettata e congelata qui.
//
// 4. Imponibile fiscale:
//      30.150,00 − 4.460,64 = 25.689,36
//
// 5. Imposta sostitutiva 15% (art. 1 c. 64 L. 190/2014):
//      15% × 25.689,36 = 3.853,404 → ceil2 = 3.853,41
//
// 6. Saldo sostitutiva (FIX A6, acconti realmente versati = 0):
//      3.853,41 − 0 = 3.853,41
//
// 7. Saldo contributi variabili (acconti contributivi versati = 0):
//      2.782,80 − 0 = 2.782,80
//
// 8. Acconti imposta 2025, metodo storico su previousTaxBase = 3.000,00:
//    3.000 ≥ 257,52 → DUE rate di pari importo (art. 58 DL 124/2019,
//    Ris. AdE 93/E/2019): 1.500,00 + 1.500,00.
// ────────────────────────────────────────────────────────────────────────────

import type { ScenarioInput } from '@server/lib/tax-engine';

export interface GoldenFixture {
  readonly input: ScenarioInput;
  readonly expected: {
    readonly forfettarioGrossIncome: number;
    readonly taxableBase: number;
    readonly substituteTax: number;
    readonly taxSaldo: number;
    readonly deductibleContributionsPaid: number;
    readonly contributiVariabiliDovuti: number;
    readonly contributionSaldo: number;
    readonly taxAccontoFirst: number;
    readonly taxAccontoSecond: number;
    readonly formula_lenght: number;
  };
}

export const MATTIA_2025: GoldenFixture = {
  input: {
    year: 2025,
    method: 'storico',
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, riduzione35: false },
    grossCollected: 45_000,
    // currentContribution / previousContribution riempiti dal test (usano i
    // parametri INPS 2025 reali via getInpsArtComForYear) — vedi
    // golden-regression.test.ts.
    currentContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: 0, // placeholder, sovrascritto dal runner
      saldoAccontoBase: 0,
      categoria: 'artigiano',
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: 0, // placeholder, sovrascritto dal runner
      saldoAccontoBase: 0,
      categoria: 'artigiano',
    },
    previousTaxBase: 3000,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  },
  // Valori RICALCOLATI A MANO — vedi derivazione passo-passo nell'header.
  expected: {
    forfettarioGrossIncome: 30_150,        // 45.000 × 0,67
    taxableBase: 25_689.36,                // 30.150 − 4.460,64
    substituteTax: 3_853.41,               // ceil2(15% × 25.689,36)
    taxSaldo: 3_853.41,                    // acconti reali = 0
    deductibleContributionsPaid: 4_460.64, // 4 rate fisse esatte da 1.115,16
    contributiVariabiliDovuti: 2_782.80,   // 24% × (30.150 − 18.555)
    contributionSaldo: 2_782.80,           // acconti contributivi reali = 0
    taxAccontoFirst: 1_500,                // 50% × 3.000 (art. 58 DL 124/2019)
    taxAccontoSecond: 1_500,               // 50% × 3.000
    formula_lenght: 5,
  },
};
