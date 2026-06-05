// src/test-fixtures/golden-regression.test.ts
// Golden regression tests: ancore numeriche sul tax-engine.
//
// Procedura di calibrazione (TDD-style per regression anchoring):
// 1. Le fixture (mattia-2025.ts, peru-2025.ts) partono con expected = 0.
// 2. Questo test fallisce al primo run.
// 3. Si leggono i valori reali dall'output di buildForfettarioScenario.
// 4. Si copiano i valori nelle fixture, sovrascrivendo gli zero placeholder.
// 5. Il test torna verde. I numeri sono ora CONGELATI: ogni futura modifica
//    al tax-engine che li altera fallira questo test, costringendo a una
//    ri-calibrazione esplicita (intenzionale, non accidentale).
//
// I numeri qui non hanno valore fiscale assoluto — sono "ancore" che
// proteggono dalla drift quando si toccano internals (params INPS, regole
// acconto, split logic, ecc.).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATTIA_2025, type GoldenFixture } from './mattia-2025';
import { PERU_2025 } from './peru-2025';
import { buildForfettarioScenario } from '@server/lib/tax-engine';
import { getInpsArtComForYear } from '@shared/inps-params';

function runFor(fx: GoldenFixture) {
  const inps = getInpsArtComForYear(fx.input.year);
  return buildForfettarioScenario({
    ...fx.input,
    currentContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps.quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 0,
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps.quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 0,
    },
  });
}

test('GOLDEN Mattia 2025: numeri tax-engine bloccati', () => {
  const out = runFor(MATTIA_2025);
  assert.equal(out.forfettarioGrossIncome, MATTIA_2025.expected.forfettarioGrossIncome);
  assert.equal(out.taxableBase, MATTIA_2025.expected.taxableBase);
  assert.equal(out.substituteTax, MATTIA_2025.expected.substituteTax);
  assert.equal(out.taxSaldo, MATTIA_2025.expected.taxSaldo);
  assert.equal(out.deductibleContributionsPaid, MATTIA_2025.expected.deductibleContributionsPaid);
  assert.equal(out.formula.length, MATTIA_2025.expected.formula_lenght);
});

test('GOLDEN Peru 2025: numeri tax-engine bloccati', () => {
  const out = runFor(PERU_2025);
  assert.equal(out.forfettarioGrossIncome, PERU_2025.expected.forfettarioGrossIncome);
  assert.equal(out.taxableBase, PERU_2025.expected.taxableBase);
  assert.equal(out.substituteTax, PERU_2025.expected.substituteTax);
  assert.equal(out.taxSaldo, PERU_2025.expected.taxSaldo);
  assert.equal(out.deductibleContributionsPaid, PERU_2025.expected.deductibleContributionsPaid);
  assert.equal(out.formula.length, PERU_2025.expected.formula_lenght);
});
