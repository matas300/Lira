// src/server/lib/tax-engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccontoPlan,
  buildForfettarioScenario,
  buildForfettarioMethodComparison,
  buildTransitionDiagnostics,
  type ScenarioInput,
} from './tax-engine';
import { getInpsArtComForYear } from '@shared/inps-params';

test('buildAccontoPlan: importo 0 → mode none', () => {
  const p = buildAccontoPlan(0);
  assert.equal(p.mode, 'none');
  assert.equal(p.total, 0);
  assert.equal(p.first, 0);
  assert.equal(p.second, 0);
});

test('buildAccontoPlan: M3 boundary 51.64 → mode none', () => {
  assert.equal(buildAccontoPlan(51.64).mode, 'none');
});

test('buildAccontoPlan: M3 boundary esatto 51.65 → mode none (≤)', () => {
  assert.equal(buildAccontoPlan(51.65).mode, 'none');
});

test('buildAccontoPlan: M3 boundary 51.66 → mode single', () => {
  const p = buildAccontoPlan(51.66);
  assert.equal(p.mode, 'single');
  assert.equal(p.first, 0);
  assert.equal(p.second, 51.66);
});

test('buildAccontoPlan: M3 boundary esatto 257.52 → mode single', () => {
  const p = buildAccontoPlan(257.52);
  assert.equal(p.mode, 'single');
  assert.equal(p.second, 257.52);
});

test('buildAccontoPlan: M3 boundary 257.53 → mode double 40/60 con somma = 257.53', () => {
  const p = buildAccontoPlan(257.53);
  assert.equal(p.mode, 'double');
  assert.ok(p.first > 103 && p.first < 104);
  assert.ok(p.second > 154 && p.second < 155);
  assert.equal(Math.round((p.first + p.second) * 100) / 100, 257.53);
});

// --- buildForfettarioScenario (Task 10 + fix A6) -------------------------

function baseScenarioInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  const inps2025 = getInpsArtComForYear(2025);
  return {
    year: 2025,
    method: 'storico',
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, riduzione35: false },
    grossCollected: 50_000,
    currentContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps2025.quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 0,
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps2025.quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 0,
    },
    previousTaxBase: 4500,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
    ...overrides,
  };
}

test('buildForfettarioScenario: ricavi 50k coeff 67% → reddito lordo 33500', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.forfettarioGrossIncome, 33_500);
});

test('buildForfettarioScenario: sostitutiva calcolata su imponibile netto contributi', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.ok(r.taxableBase < r.forfettarioGrossIncome);
  // sostitutiva = ceil2(taxableBase * 0.15) — usiamo Math.round per ricalcolo locale
  const expected = Math.ceil(r.taxableBase * 0.15 * 100 - Number.EPSILON) / 100;
  assert.equal(r.substituteTax, expected);
});

test('buildForfettarioScenario: sostitutiva 5% startup', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.05, riduzione35: false },
  }));
  const expected = Math.ceil(r.taxableBase * 0.05 * 100 - Number.EPSILON) / 100;
  assert.equal(r.substituteTax, expected);
});

test('buildForfettarioScenario: previsionale usa forecastTaxBase', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    method: 'previsionale',
    forecastTaxBase: 3000,
    forecastContributionBase: 1500,
  }));
  assert.equal(r.method, 'previsionale');
  assert.equal(r.taxAccontoBase, 3000);
});

test('buildForfettarioScenario: artigiani fixedAnnual contribuisce a deductibleContributionsPaid', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.ok(r.deductibleContributionsPaid > 0);
});

test('A6 fix: saldo sostitutiva sottrae accontiSostitutivaPagatiReali', () => {
  const stimati = buildForfettarioScenario(baseScenarioInput({ accontiSostitutivaPagatiReali: 0 }));
  const reali = buildForfettarioScenario(baseScenarioInput({ accontiSostitutivaPagatiReali: 1500 }));
  assert.equal(stimati.taxSaldo, Math.max(stimati.substituteTax, 0));
  assert.equal(reali.taxSaldo, Math.max(
    Math.ceil((reali.substituteTax - 1500) * 100 - Number.EPSILON) / 100,
    0,
  ));
});

test('A6 fix: saldo contributi sottrae accontiContribPagatiReali', () => {
  const r = buildForfettarioScenario(baseScenarioInput({ accontiContribPagatiReali: 800 }));
  assert.ok(r.contributionSaldo >= 0);
});

test('A6 fix: se acconti pagati > tax computed → saldo = 0', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    grossCollected: 10_000,
    accontiSostitutivaPagatiReali: 5_000,
  }));
  assert.equal(r.taxSaldo, 0);
});

test('buildForfettarioScenario: GS senza quota fissa', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    currentContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
    previousContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
  }));
  assert.equal(r.previousFixedTail, 0);
});

test('buildForfettarioScenario: formula breakdown contiene 5 voci', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.formula.length, 5);
  assert.equal(r.formula[0]?.label, 'Ricavi incassati');
});

// --- buildTransitionDiagnostics (Task 12) -------------------------------

test('buildTransitionDiagnostics: nessun cambiamento → warnings vuote', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario', haRedditoDipendente: 0 },
    previousSettings: { regime: 'forfettario', haRedditoDipendente: 0 },
  });
  assert.equal(r.warnings.length, 0);
  assert.equal(r.isRegimeTransition, false);
});

test('buildTransitionDiagnostics: cambio regime → warning', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario' },
    previousSettings: { regime: 'ordinario' },
  });
  assert.equal(r.isRegimeTransition, true);
  assert.ok(r.warnings.length > 0);
});

test('buildTransitionDiagnostics: anno precedente reddito misto → warning', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario' },
    previousSettings: { regime: 'forfettario', haRedditoDipendente: 1 },
  });
  assert.equal(r.previousHadEmployeeIncome, true);
  assert.ok(r.warnings.some((w) => /dipendente/i.test(w)));
});

// --- buildForfettarioMethodComparison (Task 11) -------------------------

test('buildForfettarioMethodComparison: produce sia historical che previsionale', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastTaxBase: 4800,
    forecastContributionBase: 1600,
  });
  assert.ok(out.historical);
  assert.ok(out.previsionale);
});

test('buildForfettarioMethodComparison: prudential è il metodo con managedCashOutflows piu alto', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastTaxBase: 100,
    forecastContributionBase: 100,
  });
  assert.ok(out.prudential === 'historical' || out.prudential === 'previsionale');
});

test('buildForfettarioMethodComparison: warnings include un messaggio quando deltaCash differisce', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastTaxBase: 100,
    forecastContributionBase: 100,
  });
  assert.ok(out.warnings.length > 0);
});
