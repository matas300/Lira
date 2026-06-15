import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleKey, parseScheduleKey, SCHEDULE_FAMILIES } from './schedule-keys';

test('buildScheduleKey: imposta_saldo + 2025 → "imposta_saldo_2025"', () => {
  assert.equal(buildScheduleKey('imposta_saldo', 2025), 'imposta_saldo_2025');
});

test('buildScheduleKey: tutte le famiglie producono "<family>_<year>"', () => {
  for (const f of SCHEDULE_FAMILIES) {
    const k = buildScheduleKey(f, 2026);
    assert.equal(k, `${f}_2026`);
  }
});

test('parseScheduleKey: roundtrip', () => {
  const k = buildScheduleKey('inps_fissi_3', 2025);
  const parsed = parseScheduleKey(k);
  assert.deepEqual(parsed, { family: 'inps_fissi_3', year: 2025 });
});

test('parseScheduleKey: chiave malformata → null', () => {
  assert.equal(parseScheduleKey('garbage'), null);
  assert.equal(parseScheduleKey('imposta_saldo_'), null);
  assert.equal(parseScheduleKey('imposta_saldo_abc'), null);
});

test('parseScheduleKey: family sconosciuta → null', () => {
  assert.equal(parseScheduleKey('inesistente_2025'), null);
});

test('SCHEDULE_FAMILIES contiene 15 voci (14 attive + INAIL stub)', () => {
  assert.equal(SCHEDULE_FAMILIES.length, 15);
});
