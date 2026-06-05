// src/test-fixtures/peru-2025.ts
// Golden fixture: profilo Peru, anno d'imposta 2025.
//
// Stessa logica di MATTIA_2025 (vedi mattia-2025.ts). Peru: forfettario,
// coeff 67% (allineato allo scope 2A che testa l'ATECO programmazione),
// sostitutiva 15%, artigiani. Volume incassi 35_000 € per coprire un punto
// fiscale differente (taxable base diverso → saldo differente → buon
// anchor di regressione complementare a Mattia).

import type { GoldenFixture } from './mattia-2025';

export const PERU_2025: GoldenFixture = {
  input: {
    year: 2025,
    method: 'storico',
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, riduzione35: false },
    grossCollected: 35_000,
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
    previousTaxBase: 2200,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  },
  // Valori CONGELATI: calibrati al primo run di buildForfettarioScenario
  // (vedi golden-regression.test.ts §Procedura di calibrazione).
  //
  // Derivazione:
  //   grossCollected = 35_000
  //   forfettarioGrossIncome = ceil2(35_000 * 0.67)                   = 23_450
  //   deductibleContributionsPaid = quotaFissa 2025 split 4 rate       ≈ 4_460.66
  //   taxableBase = 23_450 - 4_460.66                                  = 18_989.34
  //   substituteTax = ceil2(18_989.34 * 0.15)                          = 2_848.41
  //   taxSaldo = substituteTax - accontiSostitutivaPagatiReali (0)     = 2_848.41
  expected: {
    forfettarioGrossIncome: 23_450,
    taxableBase: 18_989.34,
    substituteTax: 2_848.41,
    taxSaldo: 2_848.41,
    deductibleContributionsPaid: 4_460.66,
    formula_lenght: 5,
  },
};
