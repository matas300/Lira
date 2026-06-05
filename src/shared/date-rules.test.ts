import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolledDueDate, isItalianHoliday, calcolaPasquetta } from './date-rules';

test('buildRolledDueDate: giorno feriale resta invariato', () => {
  const r = buildRolledDueDate('2026-06-30'); // martedì
  assert.deepEqual(r, { date: '2026-06-30', rolled: false });
});

test('buildRolledDueDate: domenica → lunedì', () => {
  const r = buildRolledDueDate('2024-06-30'); // domenica
  assert.deepEqual(r, { date: '2024-07-01', rolled: true });
});

test('buildRolledDueDate: 1 maggio (festivo) venerdì 2026 → lunedì 4', () => {
  const r = buildRolledDueDate('2026-05-01');
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2026-05-04'); // 1 ven festivo, 2-3 weekend, 4 lun
});

test('buildRolledDueDate: 25/12 venerdì 2026 → lunedì 28 (Natale+S.Stefano+weekend)', () => {
  const r = buildRolledDueDate('2026-12-25');
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2026-12-28');
});

test('isItalianHoliday: 25 aprile sì', () => {
  assert.equal(isItalianHoliday('2026-04-25'), true);
});

test('isItalianHoliday: 17 marzo no', () => {
  assert.equal(isItalianHoliday('2026-03-17'), false);
});

test('calcolaPasquetta 2026: 6 aprile', () => {
  assert.equal(calcolaPasquetta(2026), '2026-04-06');
});

test('FIX C3: 28/02/2026 sabato → 02/03/2026 lunedì', () => {
  const r = buildRolledDueDate('2026-02-28');
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2026-03-02');
});

test('FIX C3: 28/02/2027 domenica → 01/03/2027 lunedì', () => {
  const r = buildRolledDueDate('2027-02-28');
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2027-03-01');
});

test('buildRolledDueDate: 28/02/2025 venerdì → invariato', () => {
  const r = buildRolledDueDate('2025-02-28');
  assert.equal(r.rolled, false);
  assert.equal(r.date, '2025-02-28');
});

test('buildRolledDueDate: 30/06/2024 domenica → 01/07/2024', () => {
  const r = buildRolledDueDate('2024-06-30');
  assert.deepEqual(r, { date: '2024-07-01', rolled: true });
});

test('buildRolledDueDate: 16/02/2025 domenica → 17/02/2025', () => {
  const r = buildRolledDueDate('2025-02-16');
  assert.deepEqual(r, { date: '2025-02-17', rolled: true });
});
