// src/test-fixtures/peru-2025.ts
// Golden fixture: profilo Peru, anno d'imposta 2025.
//
// Stessa logica di MATTIA_2025 (vedi mattia-2025.ts). Peru: forfettario,
// coeff 67% (allineato allo scope 2A che testa l'ATECO programmazione),
// sostitutiva 15%, INPS artigiani, nessuna riduzione 35%. Volume incassi
// 35.000 € per coprire un punto fiscale differente (variabile più piccola,
// saldo diverso → ancora di regressione complementare a Mattia).
//
// I numeri in `expected` sono RICALCOLATI A MANO (audit giugno 2026), non
// snapshot dell'output del motore.
//
// ── CALCOLO MANUALE PASSO-PASSO ─────────────────────────────────────────────
//
// Parametri INPS Artigiani 2025 (Circolare INPS 38/2025):
//   minimale = 18.555,00 · quota fissa = 4.460,64 · aliquota 24%
//   (fascia 55.448 e massimale 120.607 non raggiunti)
//
// 1. Reddito forfettario lordo:    35.000 × 0,67 = 23.450,00
//
// 2. Contributi variabili dovuti 2025 (base lorda, Circ. INPS 35/2016):
//      24% × (23.450 − 18.555) = 24% × 4.895 = 1.174,80
//
// 3. Contributi versati (pianificati) nel 2025, deducibili per cassa:
//      rata 4 fissi "2024" + rate 1-3 fissi 2025 = 4 × 1.115,16 = 4.460,64
//      (saldo variabile 2024 = 0, acconti variabili 2025 = 0 — il fixture
//      parte con saldoAccontoBase prec = 0)
//
// 4. Imponibile fiscale:           23.450,00 − 4.460,64 = 18.989,36
//
// 5. Imposta sostitutiva 15%:      15% × 18.989,36 = 2.848,404 → 2.848,41
//
// 6. Saldo sostitutiva (A6):       2.848,41 − 0 = 2.848,41
//
// 7. Saldo contributi variabili:   1.174,80 − 0 = 1.174,80
//
// 8. Acconti imposta, storico su previousTaxBase = 2.200,00 ≥ 257,52
//    → due rate 50/50 (art. 58 DL 124/2019): 1.100,00 + 1.100,00.
// ────────────────────────────────────────────────────────────────────────────

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
      categoria: 'artigiano',
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: 0, // placeholder, sovrascritto dal runner
      saldoAccontoBase: 0,
      categoria: 'artigiano',
    },
    previousTaxBase: 2200,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  },
  // Valori RICALCOLATI A MANO — vedi derivazione passo-passo nell'header.
  expected: {
    forfettarioGrossIncome: 23_450,        // 35.000 × 0,67
    taxableBase: 18_989.36,                // 23.450 − 4.460,64
    substituteTax: 2_848.41,               // ceil2(15% × 18.989,36)
    taxSaldo: 2_848.41,                    // acconti reali = 0
    deductibleContributionsPaid: 4_460.64, // 4 rate fisse esatte da 1.115,16
    contributiVariabiliDovuti: 1_174.80,   // 24% × (23.450 − 18.555)
    contributionSaldo: 1_174.80,           // acconti contributivi reali = 0
    taxAccontoFirst: 1_100,                // 50% × 2.200
    taxAccontoSecond: 1_100,               // 50% × 2.200
    formula_lenght: 5,
  },
};
