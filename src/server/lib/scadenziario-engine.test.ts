// src/server/lib/scadenziario-engine.test.ts
//
// Test suite per scadenziario-engine (Task 14, fix A5 + applicazione C3).
// Verifica costruzione delle 13 righe del calendario fiscale forfettario,
// propagazione della proroga (A5) limitata alle scadenze del 30/06, e
// passaggio attraverso buildRolledDueDate per il fix C3 uniforme.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScadenziario,
  type ScadenziarioInput,
} from './scadenziario-engine';
import type { ForfettarioScenario } from './tax-engine';
import { getInpsArtComForYear } from '@shared/inps-params';

function makeScenario(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  return {
    year: 2026,
    method: 'storico',
    grossCollected: 50_000,
    forfettarioGrossIncome: 33_500,
    deductibleContributionsPaid: 4500,
    taxableBase: 29_000,
    substituteTax: 4350,
    taxSaldo: 4350,
    taxAccontoBase: 4350,
    taxAcconti: { base: 4350, total: 4350, first: 2175, second: 2175, mode: 'double' },
    contributiVariabiliDovuti: 1000,
    contributionSaldo: 1000,
    contributionAccontoBase: 0,
    contributionAcconti: { base: 0, total: 0, first: 0, second: 0, mode: 'none' },
    forecastGrossCollected: 50_000,
    forecastGrossIncome: 33_500,
    forecastContributiVariabili: 1000,
    forecastTaxableBase: 29_000,
    forecastSubstituteTax: 4350,
    previousFixedTail: 1100,
    currentFixedWithinYear: 3300,
    previousContributionSaldo: 0,
    managedCashOutflows: 8800,
    formula: [],
    explanation: [],
    ...over,
  };
}

function baseYearSettings(): ScadenziarioInput['yearSettings'] {
  return {
    regime: 'forfettario',
    coefficiente: 0.67,
    impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti',
    inpsCategoria: 'artigiano',
    riduzione_35: 0,
    riduzione_35_comunicata: 0,
    haRedditoDipendente: 0,
    scadenziarioMetodo: 'storico',
    prorogaSaldoAt: null,
  };
}

function baseInput(over: Partial<ScadenziarioInput> = {}): ScadenziarioInput {
  return {
    year: 2026,
    yearSettings: baseYearSettings(),
    previousYearSettings: null,
    scenarios: {
      historical: makeScenario(),
      previsionale: makeScenario({ method: 'previsionale' }),
    },
    paymentsByKey: new Map(),
    bolloByQuarter: { q12: 10, q3: 6, q4: 8 },
    cameraCommerce: 53,
    ...over,
  };
}

test('buildScadenziario: produce 14 righe (esclusa INAIL)', () => {
  const out = buildScadenziario(baseInput());
  assert.equal(out.rows.length, 14);
});

test('buildScadenziario: include tutte le 14 scheduleKey attese', () => {
  const out = buildScadenziario(baseInput());
  const ids = new Set(out.rows.map((r) => r.id));
  for (const k of [
    'imposta_saldo_2025', 'imposta_acc1_2026', 'imposta_acc2_2026',
    'contributi_saldo_2025', 'contributi_acc1_2026', 'contributi_acc2_2026',
    'inps_fissi_1_2026', 'inps_fissi_2_2026', 'inps_fissi_3_2026', 'inps_fissi_4_2026',
    'bollo_q12_2026', 'bollo_q3_2026', 'bollo_q4_2026',
    'camera_2025',
  ]) {
    assert.ok(ids.has(k), `manca ${k}`);
  }
});

test('bollo: Q1+Q2 scade 30/09 (rolled), Q3 scade 30/11 (rolled), Q4 28/02/N+1', () => {
  const out = buildScadenziario(baseInput({ year: 2026 }));
  const map = new Map(out.rows.map((r) => [r.id, r]));
  // Q1+Q2 → 30/09 (semplificazione ≤5.000 €: Q1 differito + Q2)
  assert.equal(map.get('bollo_q12_2026')?.dueDateOriginal, '2026-09-30');
  assert.equal(map.get('bollo_q12_2026')?.amount.point, 10);
  // Q3 (lug–set) → scadenza legale 30/11, NON 30/09
  assert.equal(map.get('bollo_q3_2026')?.dueDateOriginal, '2026-11-30');
  assert.equal(map.get('bollo_q3_2026')?.amount.point, 6);
  // Q4 → 28/02 dell'anno successivo
  assert.equal(map.get('bollo_q4_2026')?.dueDateOriginal, '2027-02-28');
  assert.equal(map.get('bollo_q4_2026')?.amount.point, 8);
});

test('FIX A5: prorogaSaldoAt propaga su saldo, acc1, camera ma NON acc2/fissi', () => {
  const ys = baseYearSettings();
  ys.prorogaSaldoAt = '2026-07-30';
  const out = buildScadenziario(baseInput({ yearSettings: ys }));
  const map = new Map(out.rows.map((r) => [r.id, r]));

  // Tutte le righe prorogabili con due-date base 30/06 → slittate alla proroga
  assert.equal(map.get('imposta_saldo_2025')?.dueDate, '2026-07-30');
  assert.equal(map.get('imposta_saldo_2025')?.prorogaApplied, true);
  assert.equal(map.get('imposta_acc1_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('imposta_acc1_2026')?.prorogaApplied, true);
  assert.equal(map.get('contributi_saldo_2025')?.dueDate, '2026-07-30');
  assert.equal(map.get('contributi_saldo_2025')?.prorogaApplied, true);
  assert.equal(map.get('contributi_acc1_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('contributi_acc1_2026')?.prorogaApplied, true);
  assert.equal(map.get('camera_2025')?.dueDate, '2026-07-30');
  assert.equal(map.get('camera_2025')?.prorogaApplied, true);

  // acc2 (30/11), fissi e bollo NON sono prorogabili
  assert.notEqual(map.get('imposta_acc2_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('imposta_acc2_2026')?.prorogaApplied, false);
  assert.notEqual(map.get('contributi_acc2_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('contributi_acc2_2026')?.prorogaApplied, false);
  assert.notEqual(map.get('inps_fissi_2_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('inps_fissi_2_2026')?.prorogaApplied, false);
  assert.notEqual(map.get('bollo_q12_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('bollo_q12_2026')?.prorogaApplied, false);
});

test('FIX A5: prorogaSaldoAt aggiunge warning A5_PROROGA_APPLICATA (info)', () => {
  const ys = baseYearSettings();
  ys.prorogaSaldoAt = '2026-07-30';
  const out = buildScadenziario(baseInput({ yearSettings: ys }));
  const w = out.warnings.find((x) => x.code === 'A5_PROROGA_APPLICATA');
  assert.ok(w, 'warning A5_PROROGA_APPLICATA atteso');
  assert.equal(w!.severity, 'info');
});

test('FIX A5: prorogaSaldoAt=null → nessun warning A5 e nessuna proroga applicata', () => {
  const out = buildScadenziario(baseInput());
  assert.equal(out.warnings.some((w) => w.code === 'A5_PROROGA_APPLICATA'), false);
  for (const row of out.rows) {
    assert.equal(row.prorogaApplied, false);
  }
});

test('FIX C3: bollo_q4 (28/02/N+1) passa attraverso buildRolledDueDate', () => {
  // Anno 2026 → bollo_q4_2026 scade 28/02/2027 che è una domenica → slitta a 01/03/2027.
  const out = buildScadenziario(baseInput({ year: 2026 }));
  const bolloQ4 = out.rows.find((r) => r.id === 'bollo_q4_2026');
  assert.ok(bolloQ4, 'bollo_q4_2026 deve esistere');
  assert.equal(bolloQ4!.dueDateOriginal, '2027-02-28');
  // 28/02/2027 = domenica → atteso lunedì 01/03/2027 oppure martedì se anche 01/03 ricade sospeso
  assert.match(bolloQ4!.dueDate, /^2027-0[23]-\d{2}$/);
  // Strict: deve essere strettamente >= 28/02/2027 (string compare ISO è valido)
  assert.ok(bolloQ4!.dueDate >= '2027-02-28');
  // E C3 specifica: il dueDate effettivo deve essere SUCCESSIVO al 28/02 quando questo cade nel weekend.
  assert.ok(bolloQ4!.dueDate > '2027-02-28', 'dueDate deve essere successiva al 28/02/2027 domenica');
  assert.equal(bolloQ4!.dueDateRolled, true);
});

test('riduzione_35=1 → inps_fissi_1 rata fissa × 0.65 arrotondata a 2 decimali (FP-safe)', () => {
  // Usa year=2025 perché INPS_ARTCOM[2025] è popolata; 2026 non ancora.
  const ys = baseYearSettings();
  ys.riduzione_35 = 1;
  const out = buildScadenziario(baseInput({ year: 2025, yearSettings: ys }));
  const fissi1 = out.rows.find((r) => r.id === 'inps_fissi_1_2025');
  assert.ok(fissi1, 'riga inps_fissi_1_2025 deve esistere');
  // 4460.64 × 0.65 / 4 = 724.854 → ceil2 = 724.86 (fix audit: niente importi
  // a 3 decimali nel calendario — non sono versabili in F24).
  assert.equal(fissi1!.amount.point, 724.86);
});

test('rata fissa senza riduzione resta l\'importo F24 esatto (1115.16, fix ceil2 FP-safe)', () => {
  const out = buildScadenziario(baseInput({ year: 2025 }));
  const inps = getInpsArtComForYear(2025);
  assert.equal(inps.quotaFissaAnnuaArtigiano, 4460.64);
  for (let i = 1; i <= 4; i++) {
    const fissi = out.rows.find((r) => r.id === `inps_fissi_${i}_2025`);
    assert.ok(fissi, `inps_fissi_${i}_2025 deve esistere`);
    assert.equal(fissi!.amount.point, 1115.16, `rata ${i} deve essere 1115.16`);
  }
});

test('inpsMode=gestione_separata → rate fisse a 0 (no minimale in GS)', () => {
  const ys = baseYearSettings();
  ys.inpsMode = 'gestione_separata';
  ys.inpsCategoria = null;
  const out = buildScadenziario(baseInput({ year: 2025, yearSettings: ys }));
  for (let i = 1; i <= 4; i++) {
    const fissi = out.rows.find((r) => r.id === `inps_fissi_${i}_2025`);
    assert.ok(fissi, `inps_fissi_${i}_2025 deve esistere anche per GS`);
    assert.equal(fissi!.amount.point, 0, `GS: rata fissa ${i} deve essere 0`);
  }
});

test('year non supportato da INPS_ARTCOM (es. 2026) → rate fisse 0 senza throw', () => {
  // 2026 non è in INPS_ARTCOM → getInpsArtComForYear throws. L'engine deve catchare e usare 0.
  const out = buildScadenziario(baseInput({ year: 2026 }));
  const fissi1 = out.rows.find((r) => r.id === 'inps_fissi_1_2026');
  assert.ok(fissi1);
  assert.equal(fissi1!.amount.point, 0);
});

test('paidTotal aggregato da paymentsByKey su una riga', () => {
  const paymentsByKey = new Map<
    string,
    { paidTotal: number; payments: Array<{ id: string; data: string; importo: number; mode: 'pure' | 'mixed' }> }
  >();
  paymentsByKey.set('imposta_saldo_2025', {
    paidTotal: 1500,
    payments: [{ id: 'p1', data: '2026-06-30', importo: 1500, mode: 'pure' }],
  });
  const out = buildScadenziario(baseInput({ paymentsByKey }));
  const saldo = out.rows.find((r) => r.id === 'imposta_saldo_2025');
  assert.ok(saldo);
  assert.equal(saldo!.paidTotal, 1500);
  assert.equal(saldo!.payments.length, 1);
  assert.equal(saldo!.payments[0]?.importo, 1500);
});

test('summary.nextDue è la prima riga non pagata ordinata per dueDate', () => {
  const out = buildScadenziario(baseInput());
  assert.ok(out.summary.nextDue, 'nextDue deve esistere quando esistono righe non pagate');
  // dueDate del prossimo dovuto deve essere <= dueDate di ogni altra riga non pagata.
  const nextDate = out.summary.nextDue!.dueDate;
  const otherDates = out.rows
    .filter((r) => r.status.code !== 'paid' && r.id !== out.summary.nextDue!.id)
    .map((r) => r.dueDate);
  for (const d of otherDates) {
    assert.ok(nextDate <= d, `nextDue ${nextDate} deve essere <= ${d}`);
  }
});

test('summary aggrega totalDue, totalPaid, totalResidual', () => {
  const paymentsByKey = new Map<
    string,
    { paidTotal: number; payments: Array<{ id: string; data: string; importo: number; mode: 'pure' | 'mixed' }> }
  >();
  paymentsByKey.set('imposta_saldo_2025', {
    paidTotal: 1000,
    payments: [{ id: 'p1', data: '2026-06-30', importo: 1000, mode: 'pure' }],
  });
  const out = buildScadenziario(baseInput({ paymentsByKey }));
  const expectedTotalDue = out.rows.reduce((s, r) => s + r.amount.point, 0);
  assert.equal(out.summary.totalDue, expectedTotalDue);
  assert.equal(out.summary.totalPaid, 1000);
  assert.equal(out.summary.totalResidual, Math.max(expectedTotalDue - 1000, 0));
});

test('tutte le righe hanno explanation di tipo string', () => {
  const out = buildScadenziario(baseInput());
  for (const r of out.rows) {
    assert.equal(typeof r.explanation, 'string');
  }
});

test('scenario method=previsionale → certainty=forecast sulle righe tax/contribution', () => {
  const ys = baseYearSettings();
  ys.scadenziarioMetodo = 'previsionale';
  const out = buildScadenziario(baseInput({ yearSettings: ys }));
  assert.equal(out.method, 'previsionale');
  const saldo = out.rows.find((r) => r.id === 'imposta_saldo_2025');
  assert.equal(saldo?.certainty, 'forecast');
  // mentre bollo/camera/fissi restano official
  assert.equal(out.rows.find((r) => r.id === 'bollo_q12_2026')?.certainty, 'official');
  assert.equal(out.rows.find((r) => r.id === 'camera_2025')?.certainty, 'official');
});

test('inps_fissi_4 ha competenceYear=N ma due date in N+1', () => {
  const out = buildScadenziario(baseInput({ year: 2025 }));
  const fissi4 = out.rows.find((r) => r.id === 'inps_fissi_4_2025');
  assert.ok(fissi4);
  assert.equal(fissi4!.competenceYear, 2025);
  assert.equal(fissi4!.dueDateOriginal, '2026-02-16');
});

test('amount low=high=point per tutte le righe (in 2A no range)', () => {
  const out = buildScadenziario(baseInput());
  for (const r of out.rows) {
    assert.equal(r.amount.low, r.amount.point, `${r.id}: low!=point`);
    assert.equal(r.amount.high, r.amount.point, `${r.id}: high!=point`);
  }
});
