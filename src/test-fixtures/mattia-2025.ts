// src/test-fixtures/mattia-2025.ts
// Golden fixture: profilo Mattia, anno d'imposta 2025.
//
// Forma "self-anchoring" (vedi golden-regression.test.ts): l'input qui sotto
// rispecchia le caratteristiche reali del contribuente (forfettario, ATECO
// 62.10.00 programmazione → coeff 67%, sostitutiva 15%, artigiani, data
// inizio attivita 2018-04-01 quindi NON startup); i numeri in `expected`
// sono stati congelati alla prima esecuzione di buildForfettarioScenario
// e fungono da ANCORA DI REGRESSIONE. Qualsiasi modifica al tax-engine
// che alteri questi numeri rompera il golden test e forzera una
// ri-calibrazione esplicita.

import type { ScenarioInput } from '@server/lib/tax-engine';

export interface GoldenFixture {
  readonly input: ScenarioInput;
  readonly expected: {
    readonly forfettarioGrossIncome: number;
    readonly taxableBase: number;
    readonly substituteTax: number;
    readonly taxSaldo: number;
    readonly deductibleContributionsPaid: number;
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
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: 0, // placeholder, sovrascritto dal runner
      saldoAccontoBase: 0,
    },
    previousTaxBase: 3000,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  },
  // Valori CONGELATI: calibrati al primo run di buildForfettarioScenario
  // (vedi golden-regression.test.ts §Procedura di calibrazione). Non
  // modificare a mano: una modifica intenzionale al tax-engine che li
  // altera richiede di rieseguire la procedura di calibrazione.
  //
  // Derivazione (per chi legge):
  //   grossCollected = 45_000
  //   forfettarioGrossIncome = ceil2(45_000 * 0.67)                  = 30_150
  //   deductibleContributionsPaid = quotaFissa 2025 (4460.64) split su 4 rate
  //     (rate 1-3 anno + rata 4 anno scorso) ≈ 4460.66 dopo ceil2
  //   taxableBase = 30_150 - 4460.66                                  = 25_689.34
  //   substituteTax = ceil2(25_689.34 * 0.15)                         = 3_853.41
  //   taxSaldo = substituteTax - accontiSostitutivaPagatiReali (0)    = 3_853.41
  expected: {
    forfettarioGrossIncome: 30_150,
    taxableBase: 25_689.34,
    substituteTax: 3_853.41,
    taxSaldo: 3_853.41,
    deductibleContributionsPaid: 4_460.66,
    formula_lenght: 5,
  },
};
