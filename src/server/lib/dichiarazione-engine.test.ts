import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroLM } from './dichiarazione-engine';
import type { ForfettarioScenario } from './tax-engine';

// Scenario sintetico coi soli campi usati dal motore dichiarazione.
function fakeScenario(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  return {
    year: 2025, method: 'storico',
    grossCollected: 30000,
    forfettarioGrossIncome: 20100,        // 30000 × 0.67
    deductibleContributionsPaid: 4000,
    taxableBase: 16100,                   // 20100 − 4000
    substituteTax: 2415,                  // 16100 × 0.15
    taxSaldo: 1415,                       // dopo 1000 di acconti reali
    taxAccontoBase: 2415, taxAcconti: { acc1: 0, acc2: 0, total: 0 } as never,
    contributiVariabiliDovuti: 1200,
    contributionSaldo: 0, contributionAccontoBase: 0,
    contributionAcconti: { acc1: 0, acc2: 0, total: 0 } as never,
    forecastGrossCollected: 30000, forecastGrossIncome: 20100,
    forecastContributiVariabili: 1200, forecastTaxableBase: 16100, forecastSubstituteTax: 2415,
    previousFixedTail: 800, currentFixedWithinYear: 3200,
    previousContributionSaldo: 0, managedCashOutflows: 0,
    formula: [], explanation: [],
    ...over,
  };
}

test('buildQuadroLM: mappa i righi chiave dallo scenario', () => {
  const righi = buildQuadroLM(fakeScenario());
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('LM1').value, 30000);    // ricavi
  assert.equal(by('LM2').value, 20100);    // reddito lordo
  assert.equal(by('LM3').value, 4000);     // contributi deducibili
  assert.equal(by('LM4').value, 16100);    // netto
  assert.equal(by('LM34').value, 16100);   // imponibile
  assert.equal(by('LM36').value, 2415);    // imposta sostitutiva
  assert.equal(by('LM43').value, 1000);    // acconti = substituteTax − taxSaldo
  assert.equal(by('LM45').value, 1415);    // saldo a debito
  assert.equal(by('LM1').source, 'computed');
});

test('buildQuadroLM: acconti (LM43) mai negativi', () => {
  const righi = buildQuadroLM(fakeScenario({ substituteTax: 500, taxSaldo: 500 }));
  assert.equal(righi.find((r) => r.key === 'LM43')!.value, 0);
});
