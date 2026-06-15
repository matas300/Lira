// src/test-fixtures/golden-regression.test.ts
// Golden regression tests: ancore numeriche sul tax-engine.
//
// I valori `expected` delle fixture (mattia-2025.ts, peru-2025.ts) sono
// CALCOLATI A MANO con le fonti normative (vedi la derivazione passo-passo
// nei commenti di ciascuna fixture), NON congelati dall'output del motore:
// il golden è un controllo INDIPENDENTE. Ogni futura modifica al tax-engine
// che alteri questi numeri fallirà il test e imporrà di rifare il calcolo
// manuale, non di ricopiare l'output.
//
// Ricalibrazione audit giugno 2026: introdotti contributi INPS variabili
// (quota eccedente il minimale), acconti imposta 50/50 (art. 58 DL 124/2019)
// e ceil2 FP-safe (4 rate fisse uguali da 1.115,16 → deducibile 4.460,64,
// non più 4.460,66).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATTIA_2025, type GoldenFixture } from './mattia-2025';
import { PERU_2025 } from './peru-2025';
import { buildForfettarioScenario, type ForfettarioScenario } from '@server/lib/tax-engine';
import { getInpsArtComForYear } from '@shared/inps-params';

function runFor(fx: GoldenFixture) {
  const inps = getInpsArtComForYear(fx.input.year);
  return buildForfettarioScenario({
    ...fx.input,
    currentContribution: {
      ...fx.input.currentContribution,
      fixedAnnual: inps.quotaFissaAnnuaArtigiano,
    },
    previousContribution: {
      ...fx.input.previousContribution,
      fixedAnnual: inps.quotaFissaAnnuaArtigiano,
    },
  });
}

function assertGolden(out: ForfettarioScenario, fx: GoldenFixture) {
  assert.equal(out.forfettarioGrossIncome, fx.expected.forfettarioGrossIncome);
  assert.equal(out.taxableBase, fx.expected.taxableBase);
  assert.equal(out.substituteTax, fx.expected.substituteTax);
  assert.equal(out.taxSaldo, fx.expected.taxSaldo);
  assert.equal(out.deductibleContributionsPaid, fx.expected.deductibleContributionsPaid);
  assert.equal(out.contributiVariabiliDovuti, fx.expected.contributiVariabiliDovuti);
  assert.equal(out.contributionSaldo, fx.expected.contributionSaldo);
  assert.equal(out.taxAcconti.first, fx.expected.taxAccontoFirst);
  assert.equal(out.taxAcconti.second, fx.expected.taxAccontoSecond);
  assert.equal(out.formula.length, fx.expected.formula_lenght);
}

test('GOLDEN Mattia 2025: numeri tax-engine bloccati (calcolo manuale)', () => {
  assertGolden(runFor(MATTIA_2025), MATTIA_2025);
});

test('GOLDEN Peru 2025: numeri tax-engine bloccati (calcolo manuale)', () => {
  assertGolden(runFor(PERU_2025), PERU_2025);
});
