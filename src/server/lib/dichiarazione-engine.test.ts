import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroLM, buildQuadroRR, buildQuadroRX, buildQuadroRS } from './dichiarazione-engine';
import { buildFrontespizio, buildWarnings, buildDichiarazione } from './dichiarazione-engine';
import { inpsCausale, buildF24, buildF24Warnings } from './dichiarazione-engine';
import { applyDichiarazioneOverrides } from './dichiarazione-engine';
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

const appliedDefault = (over = {}) => applyDichiarazioneOverrides(fakeScenario(over), {});

test('buildQuadroLM: mappa i righi chiave dallo scenario', () => {
  const righi = buildQuadroLM(fakeScenario(), applyDichiarazioneOverrides(fakeScenario(), {}));
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
  const s = fakeScenario({ substituteTax: 500, taxSaldo: 500 });
  const righi = buildQuadroLM(s, applyDichiarazioneOverrides(s, {}));
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
  const righi = buildQuadroRX(applyDichiarazioneOverrides(fakeScenario(), {}));
  assert.equal(righi.find((r) => r.key === 'RX1')!.value, 0);
  assert.equal(righi.find((r) => r.key === 'RX1')!.source, 'zero');
});

test('buildQuadroRS: vuoto in 6A (informativo, popolato in 6C)', () => {
  assert.deepEqual(buildQuadroRS(), []);
});

test('buildQuadroLM: include LM39 e usa saldoEffettivo per LM45', () => {
  const s = fakeScenario();
  const a = applyDichiarazioneOverrides(s, { creditiImposta: 200, accontiVersati: 800 });
  const righi = buildQuadroLM(s, a);
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('LM36').value, 2415);
  assert.equal(by('LM39').value, 200);
  assert.equal(by('LM39').source, 'override');
  assert.equal(by('LM43').value, 800);
  assert.equal(by('LM43').source, 'override');
  assert.equal(by('LM45').value, 1415); // 2415 − 200 − 800
});

test('buildQuadroLM: default → LM39 zero, LM43 computed (non override)', () => {
  const s = fakeScenario();
  const righi = buildQuadroLM(s, applyDichiarazioneOverrides(s, {}));
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('LM39').value, 0);
  assert.equal(by('LM39').source, 'zero');
  assert.equal(by('LM43').source, 'computed');
  assert.equal(by('LM45').value, 1415);
});

test('buildQuadroRX: RX1 da override, RX4 = credito da riportare', () => {
  const s = fakeScenario();
  const a = applyDichiarazioneOverrides(s, { creditoAnnoPrec: 2000 });
  const righi = buildQuadroRX(a);
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('RX1').value, 2000);
  assert.equal(by('RX1').source, 'override');
  // detrazioni = 1000(acc) + 2000 = 3000 > 2415 → RX4 = 585
  assert.equal(by('RX4').value, 585);
  assert.equal(by('RX4').source, 'computed');
});

const ysBase: DichiarazioneYsView = {
  regime: 'forfettario', inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  impostaSostitutiva: 0.15, coefficiente: 0.67, limiteForfettario: 85000, prorogaSaldoAt: null,
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

test('buildDichiarazione: include f24 e i warning F24', () => {
  const d = buildDichiarazione(input());
  assert.equal(d.f24.length, 2);
  assert.ok(d.warnings.some((w) => w.code === 'F24_INPS_SEDE_MANCANTE'));
});

test('inpsCausale: artigiani/commercianti/gestione separata', () => {
  assert.equal(inpsCausale('gestione_separata', null), 'P10');
  assert.equal(inpsCausale('artigiani_commercianti', 'commerciante'), 'CP');
  assert.equal(inpsCausale('artigiani_commercianti', 'artigiano'), 'AP');
  assert.equal(inpsCausale('artigiani_commercianti', null), 'AP'); // default artigiano
});

const ys2025 = {
  regime: 'forfettario', inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  impostaSostitutiva: 0.15, coefficiente: 0.67, limiteForfettario: 85000, prorogaSaldoAt: null,
} as const;

test('buildF24: due moduli 30/06 e 30/11 dell\'anno N+1', () => {
  // scenario default: substituteTax 2415, taxSaldo 1415, contributiVariabiliDovuti 1200, contributionSaldo 0
  const mods = buildF24(fakeScenario(), { ...ys2025 }, 2025);
  assert.equal(mods.length, 2);

  const giugno = mods[0]!;
  assert.equal(giugno.scadenzaOriginale, '2026-06-30');
  assert.equal(giugno.scadenza, '2026-06-30'); // 30/06/2026 è martedì, nessun rolling
  assert.equal(giugno.prorogaApplied, false);
  // saldo sostitutiva (anno 2025) + acconto 1 (anno 2026); INPS saldo 0 omesso, INPS acc1 600
  assert.deepEqual(giugno.righe.map((r) => [r.sezione, r.codice, r.annoRiferimento, r.importo]), [
    ['erario', '1792', 2025, 1415],
    ['erario', '1790', 2026, 1207.5],
    ['inps', 'AP', 2026, 600],
  ]);
  assert.equal(giugno.totale, 3222.5);

  const nov = mods[1]!;
  assert.equal(nov.scadenzaOriginale, '2026-11-30');
  assert.equal(nov.scadenza, '2026-11-30'); // 30/11/2026 è lunedì, nessun rolling
  assert.deepEqual(nov.righe.map((r) => [r.sezione, r.codice, r.annoRiferimento, r.importo]), [
    ['erario', '1791', 2026, 1207.5],
    ['inps', 'AP', 2026, 600],
  ]);
  assert.equal(nov.totale, 1807.5);
});

test('buildF24: acconto base è imposta(N) lorda, NON il saldo', () => {
  // substituteTax 2415 → acconti 1207.5/1207.5, indipendenti da taxSaldo 1415
  const mods = buildF24(fakeScenario({ taxSaldo: 1 }), { ...ys2025 }, 2025);
  const acc1 = mods[0]!.righe.find((r) => r.codice === '1790')!;
  assert.equal(acc1.importo, 1207.5);
});

test('buildF24: saldo INPS valorizzato compare in sezione INPS anno N', () => {
  const mods = buildF24(fakeScenario({ contributionSaldo: 350 }), { ...ys2025 }, 2025);
  const inpsSaldo = mods[0]!.righe.find((r) => r.sezione === 'inps' && r.annoRiferimento === 2025)!;
  assert.equal(inpsSaldo.codice, 'AP');
  assert.equal(inpsSaldo.importo, 350);
});

test('buildF24: banda unico-novembre (51,65 ≤ imposta < 257,52) → acc1=0 omesso, acc2 pieno', () => {
  const mods = buildF24(fakeScenario({ substituteTax: 100, taxSaldo: 0, contributiVariabiliDovuti: 0, contributionSaldo: 0 }), { ...ys2025 }, 2025);
  // giugno: nessun acconto sostitutiva (first=0), nessun saldo (0) → modulo vuoto omesso
  // novembre: acconto unico 100
  assert.equal(mods.length, 1);
  assert.equal(mods[0]!.scadenzaOriginale, '2026-11-30');
  assert.deepEqual(mods[0]!.righe.map((r) => [r.codice, r.importo]), [['1791', 100]]);
});

test('buildF24: imposta sotto soglia (<51,65) e niente saldo → nessun modulo', () => {
  const mods = buildF24(fakeScenario({ substituteTax: 40, taxSaldo: 0, contributiVariabiliDovuti: 0, contributionSaldo: 0 }), { ...ys2025 }, 2025);
  assert.equal(mods.length, 0);
});

test('buildF24: gestione separata usa causale P10 e acconto 80% (40/40)', () => {
  const mods = buildF24(
    fakeScenario({ contributiVariabiliDovuti: 1000, contributionSaldo: 0 }),
    { ...ys2025, inpsMode: 'gestione_separata', inpsCategoria: null },
    2025,
  );
  const inpsAcc1 = mods[0]!.righe.find((r) => r.sezione === 'inps')!;
  assert.equal(inpsAcc1.codice, 'P10');
  assert.equal(inpsAcc1.importo, 400); // 1000 × 40%
  const inpsAcc2 = mods[1]!.righe.find((r) => r.sezione === 'inps')!;
  assert.equal(inpsAcc2.importo, 400);
});

test('buildF24: proroga sposta solo il 30/06, non il 30/11', () => {
  const mods = buildF24(fakeScenario(), { ...ys2025, prorogaSaldoAt: '2026-07-31' }, 2025);
  assert.equal(mods[0]!.scadenza, '2026-07-31');
  assert.equal(mods[0]!.prorogaApplied, true);
  assert.equal(mods[1]!.scadenza, '2026-11-30');
  assert.equal(mods[1]!.prorogaApplied, false);
});

test('buildF24: regime non forfettario → nessun modulo', () => {
  const mods = buildF24(fakeScenario(), { ...ys2025, regime: 'ordinario' }, 2025);
  assert.equal(mods.length, 0);
});

test('buildF24Warnings: sede INPS mancante quando ci sono moduli', () => {
  const mods = buildF24(fakeScenario(), { ...ys2025 }, 2025);
  const w = buildF24Warnings(mods, fakeScenario(), { ...ys2025 });
  assert.ok(w.some((x) => x.code === 'F24_INPS_SEDE_MANCANTE' && x.severity === 'info'));
});

test('buildF24Warnings: acconti sotto soglia segnalati (imposta 0<x<51,65)', () => {
  const s = fakeScenario({ substituteTax: 40, taxSaldo: 0, contributiVariabiliDovuti: 0, contributionSaldo: 0 });
  const mods = buildF24(s, { ...ys2025 }, 2025);
  const w = buildF24Warnings(mods, s, { ...ys2025 });
  assert.ok(w.some((x) => x.code === 'F24_ACCONTI_SOTTO_SOGLIA' && x.severity === 'info'));
});

test('buildF24Warnings: regime non forfettario → nessun warning F24', () => {
  const w = buildF24Warnings([], fakeScenario(), { ...ys2025, regime: 'ordinario' });
  assert.equal(w.length, 0);
});

test('GOLDEN F24: commerciante usa CP, importi bloccati', () => {
  const s = fakeScenario({ substituteTax: 3000, taxSaldo: 1200, contributiVariabiliDovuti: 800, contributionSaldo: 200 });
  const mods = buildF24(s, { ...ys2025, inpsCategoria: 'commerciante' }, 2025);
  // giugno: 1792=1200(2025), 1790=1500(2026), CP saldo=200(2025), CP acc1=400(2026)
  assert.deepEqual(mods[0]!.righe.map((r) => [r.codice, r.annoRiferimento, r.importo]), [
    ['1792', 2025, 1200], ['1790', 2026, 1500], ['CP', 2025, 200], ['CP', 2026, 400],
  ]);
  assert.equal(mods[0]!.totale, 3300);
  // novembre: 1791=1500(2026), CP acc2=400(2026)
  assert.deepEqual(mods[1]!.righe.map((r) => [r.codice, r.annoRiferimento, r.importo]), [
    ['1791', 2026, 1500], ['CP', 2026, 400],
  ]);
  assert.equal(mods[1]!.totale, 1900);
});

test('applyDichiarazioneOverrides: default → invariante 6A (saldoEffettivo === taxSaldo)', () => {
  const s = fakeScenario(); // substituteTax 2415, taxSaldo 1415
  const a = applyDichiarazioneOverrides(s, {});
  assert.equal(a.imposta, 2415);
  assert.equal(a.accontiVersati, 1000);     // 2415 − 1415 (acconti imputati)
  assert.equal(a.creditiImposta, 0);
  assert.equal(a.creditoAnnoPrec, 0);
  assert.equal(a.saldoEffettivo, 1415);     // === taxSaldo
  assert.equal(a.creditoDaRiportare, 0);
  assert.deepEqual(a.overridden, { accontiVersati: false, creditiImposta: false, creditoAnnoPrec: false });
});

test('applyDichiarazioneOverrides: override acconti cambia il saldo', () => {
  const a = applyDichiarazioneOverrides(fakeScenario(), { accontiVersati: 2000 });
  assert.equal(a.accontiVersati, 2000);
  assert.equal(a.overridden.accontiVersati, true);
  assert.equal(a.saldoEffettivo, 415);      // 2415 − 2000
  assert.equal(a.creditoDaRiportare, 0);
});

test('applyDichiarazioneOverrides: crediti + credito anno prec riducono il saldo, eccedenza → RX4', () => {
  const a = applyDichiarazioneOverrides(fakeScenario(), { creditiImposta: 500, creditoAnnoPrec: 2200 });
  // detrazioni = 500 + 1000(acc default) + 2200 = 3700 > 2415
  assert.equal(a.saldoEffettivo, 0);
  assert.equal(a.creditoDaRiportare, 1285); // 3700 − 2415
  assert.deepEqual(a.overridden, { accontiVersati: false, creditiImposta: true, creditoAnnoPrec: true });
});

test('applyDichiarazioneOverrides: valori non validi (neg/NaN/null) → default, non overridden', () => {
  const a = applyDichiarazioneOverrides(fakeScenario(), { accontiVersati: -5, creditiImposta: null });
  assert.equal(a.accontiVersati, 1000); // default
  assert.equal(a.overridden.accontiVersati, false);
  assert.equal(a.creditiImposta, 0);
  assert.equal(a.overridden.creditiImposta, false);
});
