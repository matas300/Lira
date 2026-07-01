import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkC1_soglia,
  checkA1_sostitutivaStartup,
  checkM1_riduzione35NonComunicata,
  evaluateAuditChecks,
  type AuditContext,
} from './audit-checks';

function baseCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    year: 2026,
    yearSettings: {
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
      riduzione_35: 0,
      riduzione_35_comunicata: 0,
      scadenziarioMetodo: 'storico',
    },
    profile: { dataInizioAttivita: '2018-04-01' },
    grossCollected: 50_000,
    today: '2026-06-05',
    ...overrides,
  };
}

test('C1: grossCollected < 85k → null', () => {
  assert.equal(checkC1_soglia(baseCtx({ grossCollected: 50_000 })), null);
});

test('C1: 85k < grossCollected ≤ 100k → C1_SOGLIA_85K_SUPERATA', () => {
  const r = checkC1_soglia(baseCtx({ grossCollected: 90_000 }));
  assert.equal(r?.code, 'C1_SOGLIA_85K_SUPERATA');
  assert.equal(r?.severity, 'warning');
});

test('C1: grossCollected esattamente 85k → null (uguaglianza ammessa)', () => {
  assert.equal(checkC1_soglia(baseCtx({ grossCollected: 85_000 })), null);
});

test('C1: grossCollected > 100k → C1_CESSAZIONE_IMMEDIATA (block)', () => {
  const r = checkC1_soglia(baseCtx({ grossCollected: 105_000 }));
  assert.equal(r?.code, 'C1_CESSAZIONE_IMMEDIATA');
  assert.equal(r?.severity, 'block');
});

test('A1: sostitutiva 15% → null', () => {
  assert.equal(checkA1_sostitutivaStartup(baseCtx()), null);
});

test('A1: 5% & attività < 5 anni → info', () => {
  const r = checkA1_sostitutivaStartup(baseCtx({
    year: 2022,
    yearSettings: { ...baseCtx().yearSettings, impostaSostitutiva: 0.05 },
    profile: { dataInizioAttivita: '2020-01-01' },
  }));
  assert.equal(r?.code, 'A1_SOSTITUTIVA_5_REQUISITI');
  assert.equal(r?.severity, 'info');
});

test('A1: 5% & attività ≥ 5 anni → block', () => {
  const r = checkA1_sostitutivaStartup(baseCtx({
    year: 2026,
    yearSettings: { ...baseCtx().yearSettings, impostaSostitutiva: 0.05 },
    profile: { dataInizioAttivita: '2018-01-01' },
  }));
  assert.equal(r?.code, 'A1_SOSTITUTIVA_5_NON_AMMESSA');
  assert.equal(r?.severity, 'block');
});

test('M1: riduzione_35=1 e comunicata=0 → warning', () => {
  const r = checkM1_riduzione35NonComunicata(baseCtx({
    yearSettings: { ...baseCtx().yearSettings, riduzione_35: 1, riduzione_35_comunicata: 0 },
  }));
  assert.equal(r?.code, 'M1_RIDUZIONE_35_NON_COMUNICATA');
  assert.equal(r?.severity, 'warning');
});

test('M1: riduzione_35=1 e comunicata=1 → null', () => {
  assert.equal(checkM1_riduzione35NonComunicata(baseCtx({
    yearSettings: { ...baseCtx().yearSettings, riduzione_35: 1, riduzione_35_comunicata: 1 },
  })), null);
});

test('M1: riduzione_35=0 → null', () => {
  assert.equal(checkM1_riduzione35NonComunicata(baseCtx()), null);
});

test('evaluateAuditChecks: aggrega + NO_REVENUE_SOURCE', () => {
  const ws = evaluateAuditChecks(baseCtx({
    grossCollected: 0,
    yearSettings: { ...baseCtx().yearSettings, riduzione_35: 1, riduzione_35_comunicata: 0 },
  }));
  const codes = ws.map((w) => w.code);
  assert.ok(codes.includes('NO_REVENUE_SOURCE'));
  assert.ok(codes.includes('M1_RIDUZIONE_35_NON_COMUNICATA'));
});

test('evaluateAuditChecks: nessuna warning quando tutto regolare', () => {
  const ws = evaluateAuditChecks(baseCtx());
  assert.equal(ws.length, 0);
});
