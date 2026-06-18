import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroLM, buildQuadroRR, buildQuadroRX, buildQuadroRS } from './dichiarazione-engine';
import { buildFrontespizio, buildWarnings, buildDichiarazione } from './dichiarazione-engine';
import { inpsCausale } from './dichiarazione-engine';
import type { DichiarazioneInput, DichiarazioneYsView } from './dichiarazione-engine';
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
    // 6A non legge gli acconti: shape placeholder (l'AccontoPlan reale serve in 6B/RR-acconti).
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

test('buildQuadroRR: gestione separata → contributi dovuti dai variabili, niente fissi', () => {
  const q = buildQuadroRR(fakeScenario(), 'gestione_separata');
  assert.equal(q.sezione, 'gestione_separata');
  const dovuti = q.righi.find((r) => r.key === 'RR_GS_DOVUTI')!;
  assert.equal(dovuti.value, 1200); // contributiVariabiliDovuti
  assert.ok(!q.righi.some((r) => r.key === 'RR_FISSI'));
});

test('buildQuadroRR: artigiani/commercianti → fissi + variabili + totale', () => {
  const q = buildQuadroRR(fakeScenario(), 'artigiani_commercianti');
  assert.equal(q.sezione, 'artigiani_commercianti');
  assert.equal(q.righi.find((r) => r.key === 'RR_FISSI')!.value, 4000); // 800 + 3200
  assert.equal(q.righi.find((r) => r.key === 'RR_VARIABILI')!.value, 1200);
  assert.equal(q.righi.find((r) => r.key === 'RR_TOTALE')!.value, 5200);
});

test('buildQuadroRX: credito anno prec a 0 (6A), source zero', () => {
  const righi = buildQuadroRX();
  assert.equal(righi.find((r) => r.key === 'RX1')!.value, 0);
  assert.equal(righi.find((r) => r.key === 'RX1')!.source, 'zero');
});

test('buildQuadroRS: vuoto in 6A (informativo, popolato in 6C)', () => {
  assert.deepEqual(buildQuadroRS(), []);
});

const ysBase: DichiarazioneYsView = {
  regime: 'forfettario', inpsMode: 'artigiani_commercianti',
  impostaSostitutiva: 0.15, coefficiente: 0.67, limiteForfettario: 85000,
};
function input(over: Partial<DichiarazioneInput> = {}): DichiarazioneInput {
  return {
    year: 2025, scenario: fakeScenario(), ys: ysBase,
    anagrafica: { cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-01', residenza: { citta: 'Roma', provincia: 'RM' } },
    dataInizioAttivita: '2022-01-01',
    ...over,
  };
}

test('buildFrontespizio: campi dal profilo, regime RF19', () => {
  const f = buildFrontespizio(input());
  assert.equal(f.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(f.cognome, 'Rossi');
  assert.equal(f.annoImposta, 2025);
  assert.equal(f.regime, 'RF19');
});

test('buildWarnings: frontespizio incompleto → error', () => {
  const w = buildWarnings(input({ anagrafica: { nome: 'Mario' } }));
  assert.ok(w.some((x) => x.code === 'FRONTESPIZIO_INCOMPLETO' && x.severity === 'error'));
});

test('buildWarnings: regime non forfettario → error', () => {
  const w = buildWarnings(input({ ys: { ...ysBase, regime: 'ordinario' } }));
  assert.ok(w.some((x) => x.code === 'REGIME_NON_FORFETTARIO' && x.severity === 'error'));
});

test('buildWarnings: ricavi oltre 85k → warn; oltre 100k → warn aggiuntivo (mutuo esclusivo)', () => {
  const w85 = buildWarnings(input({ scenario: fakeScenario({ grossCollected: 90000 }) }));
  assert.ok(w85.some((x) => x.code === 'SOGLIA_85K'));
  assert.ok(!w85.some((x) => x.code === 'SOGLIA_100K'));
  const w100 = buildWarnings(input({ scenario: fakeScenario({ grossCollected: 101000 }) }));
  assert.ok(w100.some((x) => x.code === 'SOGLIA_100K'));
  assert.ok(!w100.some((x) => x.code === 'SOGLIA_85K')); // else-if: non entrambi
});

test('buildWarnings: startup 5% oltre 5 anni → warn', () => {
  const w = buildWarnings(input({ ys: { ...ysBase, impostaSostitutiva: 0.05 }, dataInizioAttivita: '2018-01-01' }));
  assert.ok(w.some((x) => x.code === 'STARTUP_5PCT_SCADUTO'));
});

test('buildWarnings: RS informativo sempre info', () => {
  assert.ok(buildWarnings(input()).some((x) => x.code === 'RS_INFORMATIVO' && x.severity === 'info'));
});

test('buildDichiarazione: assembla tutti i quadri', () => {
  const d = buildDichiarazione(input());
  assert.equal(d.quadroLM.length, 8);
  assert.equal(d.quadroRR.sezione, 'artigiani_commercianti');
  assert.equal(d.quadroRX.length, 2);
  assert.equal(d.frontespizio.regime, 'RF19');
  assert.ok(Array.isArray(d.warnings));
});

test('inpsCausale: artigiani/commercianti/gestione separata', () => {
  assert.equal(inpsCausale('gestione_separata', null), 'P10');
  assert.equal(inpsCausale('artigiani_commercianti', 'commerciante'), 'CP');
  assert.equal(inpsCausale('artigiani_commercianti', 'artigiano'), 'AP');
  assert.equal(inpsCausale('artigiani_commercianti', null), 'AP'); // default artigiano
});
