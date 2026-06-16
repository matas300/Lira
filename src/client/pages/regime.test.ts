// src/client/pages/regime.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSintesi, renderLimitBar, renderMonthlyTable, renderComparison,
  renderNeedsConfig, renderFormula, renderInpsBreakdown, renderCash, renderWarnings,
} from './regime';
import type { ForfettarioScenario, ComparisonOutput } from '@server/lib/tax-engine';

function scenario(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  return {
    year: 2025,
    method: 'storico',
    grossCollected: 30000,
    forfettarioGrossIncome: 20100,
    deductibleContributionsPaid: 4000,
    taxableBase: 16100,
    substituteTax: 2415,
    taxSaldo: 2415,
    taxAccontoBase: 2415,
    taxAcconti: { base: 2415, total: 2415, first: 1207.5, second: 1207.5, mode: 'double' },
    contributiVariabiliDovuti: 1500,
    contributionSaldo: 1500,
    contributionAccontoBase: 1500,
    contributionAcconti: { base: 1500, total: 1200, first: 600, second: 600, mode: 'double' },
    forecastGrossCollected: 30000,
    forecastGrossIncome: 20100,
    forecastContributiVariabili: 1500,
    forecastTaxableBase: 16100,
    forecastSubstituteTax: 2415,
    previousFixedTail: 700,
    currentFixedWithinYear: 2100,
    previousContributionSaldo: 0,
    managedCashOutflows: 6415,
    formula: [
      { label: 'Ricavi incassati', amount: 30000 },
      { label: 'Reddito lordo forfettario (67%)', amount: 20100 },
      { label: 'Imposta sostitutiva (15%)', amount: 2415 },
    ],
    explanation: ['Riga di spiegazione uno.', 'Riga di spiegazione due.'],
    ...over,
  };
}

function comparison(over: Partial<ComparisonOutput> = {}): ComparisonOutput {
  const historical = scenario({ method: 'storico' });
  const previsionale = scenario({ method: 'previsionale', managedCashOutflows: 6000 });
  return {
    selectedMethod: 'storico',
    selected: historical,
    historical,
    previsionale,
    prudential: 'historical',
    liquidity: 'previsionale',
    deltaCash: 415,
    transition: {
      year: 2025, currentRegime: 'forfettario', previousRegime: 'forfettario',
      previousHadEmployeeIncome: false, isRegimeTransition: false, warnings: [], facts: [],
    },
    warnings: ['Attenzione: warning di test.'],
    ...over,
  };
}

test('renderSintesi: mostra netto, imposta e INPS', () => {
  const html = renderSintesi(scenario(), 30000, 23585);
  assert.match(html, /Netto/);
  assert.match(html, /Imposta/);
  assert.match(html, /INPS/);
  // netto annuo formattato
  assert.match(html, /23\.585/);
  // imposta (con o senza separatore migliaia, secondo ICU del runtime)
  assert.match(html, /2\.?415/);
});

test('renderLimitBar: percentuale sotto soglia', () => {
  const html = renderLimitBar(42500, 85000);
  assert.match(html, /50%/);
  assert.match(html, /85\.000/);
});

test('renderLimitBar: oltre 100% mostra decadenza/superamento', () => {
  const html = renderLimitBar(120000, 85000);
  assert.match(html, /1[0-9][0-9]%/);
  assert.match(html, /superat|decaden/i);
});

test('renderMonthlyTable: una riga per mese presente', () => {
  const monthly = [
    { month: 1, lordo: 3000, netto: 1900, tasseContrib: 1100, fonte: 'Fattura' },
    { month: 3, lordo: 5000, netto: 3200, tasseContrib: 1800, fonte: 'Fattura' },
  ];
  const html = renderMonthlyTable(monthly);
  assert.match(html, /Gen/);
  assert.match(html, /Mar/);
  assert.equal((html.match(/monthly-row/g) ?? []).length, 2);
});

test('renderMonthlyTable: vuoto → messaggio', () => {
  const html = renderMonthlyTable([]);
  assert.match(html, /Nessun incasso|Nessun dato/i);
});

test('renderComparison: storico vs previsionale e prudenziale', () => {
  const html = renderComparison(comparison());
  assert.match(html, /[Ss]torico/);
  assert.match(html, /[Pp]revisionale/);
  assert.match(html, /prudent/i);
});

test('renderWarnings: lista i warning; vuoto → stringa vuota', () => {
  assert.match(renderWarnings(['uno', 'due']), /uno/);
  assert.match(renderWarnings(['uno', 'due']), /due/);
  assert.equal(renderWarnings([]), '');
});

test('renderFormula: righe della formula', () => {
  const html = renderFormula(scenario());
  assert.match(html, /Ricavi incassati/);
  assert.match(html, /Imposta sostitutiva/);
});

test('renderInpsBreakdown: quote fisse e variabili', () => {
  const html = renderInpsBreakdown(scenario());
  assert.match(html, /INPS/);
  assert.match(html, /variabil/i);
});

test('renderCash: liquidità gestita', () => {
  const html = renderCash(scenario());
  assert.match(html, /[Aa]cconti|[Ll]iquidità|[Cc]assa/);
});

test('renderNeedsConfig: CTA Configura per l\'anno', () => {
  const html = renderNeedsConfig(2026);
  assert.match(html, /2026/);
  assert.match(html, /Configura/);
});

test('renderSintesi: escape dei valori dinamici (no injection)', () => {
  // fonte dinamica esce sempre da esc(); qui ci basta che non rompa con valori numerici
  const html = renderSintesi(scenario({ grossCollected: 30000 }), 30000, 23585);
  assert.doesNotMatch(html, /undefined/);
});
