// src/client/lib/calendar-defaults.test.ts
// TDD tests for calendar-defaults.ts
// Run: npx tsx --test src/client/lib/calendar-defaults.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultActivity, isItalianHoliday } from './calendar-defaults';

// ─── isItalianHoliday ───

test('1 Gennaio (Capodanno) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 1, 1), true);
});

test('6 Gennaio (Epifania) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 1, 6), true);
});

test('25 Aprile (Liberazione) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 4, 25), true);
});

test('1 Maggio (Festa del Lavoro) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 5, 1), true);
});

test('2 Giugno (Festa della Repubblica) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 6, 2), true);
});

test('15 Agosto (Ferragosto) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 8, 15), true);
});

test('1 Novembre (Tutti i Santi) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 11, 1), true);
});

test('8 Dicembre (Immacolata) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 12, 8), true);
});

test('25 Dicembre (Natale) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 12, 25), true);
});

test('26 Dicembre (Santo Stefano) è festivo', () => {
  assert.equal(isItalianHoliday(2025, 12, 26), true);
});

// Pasqua 2025 = 20 Aprile (domenica)
// Pasquetta 2025 = 21 Aprile (lunedì)
test('Pasqua 2025 (20/4) è festiva', () => {
  assert.equal(isItalianHoliday(2025, 4, 20), true);
});

test('Pasquetta 2025 (21/4) è festiva', () => {
  assert.equal(isItalianHoliday(2025, 4, 21), true);
});

// Pasqua 2024 = 31 Marzo (domenica)
// Pasquetta 2024 = 1 Aprile (lunedì)
test('Pasquetta 2024 (1/4) è festiva', () => {
  assert.equal(isItalianHoliday(2024, 4, 1), true);
});

test('Un mercoledì qualsiasi non è festivo', () => {
  // 2025-03-12 = mercoledì
  assert.equal(isItalianHoliday(2025, 3, 12), false);
});

test('2 Aprile 2025 non è festivo (è un mercoledì)', () => {
  assert.equal(isItalianHoliday(2025, 4, 2), false);
});

// ─── getDefaultActivity: ordine WE > festivo ───

// CalcoliVari: prima controlla dow === 0 || dow === 6 → 'WE'; poi isHoliday → 'FS'
// Quindi un festivo fisso che cade di sabato/domenica → 'WE'

test('Sabato feriale → WE', () => {
  // 2025-03-15 = sabato
  assert.equal(getDefaultActivity(2025, 3, 15), 'WE');
});

test('Domenica feriale → WE', () => {
  // 2025-03-16 = domenica
  assert.equal(getDefaultActivity(2025, 3, 16), 'WE');
});

test('Mercoledì qualsiasi → 8', () => {
  // 2025-03-12 = mercoledì
  assert.equal(getDefaultActivity(2025, 3, 12), '8');
});

test('25 Dicembre 2022 (domenica, Natale) → WE (WE ha priorità su FS)', () => {
  // 2022-12-25 = domenica → WE precede FS
  assert.equal(getDefaultActivity(2022, 12, 25), 'WE');
});

test('25 Dicembre 2025 (giovedì, Natale) → FS', () => {
  // 2025-12-25 = giovedì
  assert.equal(getDefaultActivity(2025, 12, 25), 'FS');
});

test('Pasquetta 2025 (21/4/2025, lunedì) → FS', () => {
  assert.equal(getDefaultActivity(2025, 4, 21), 'FS');
});

test('25 Aprile 2025 (venerdì, Liberazione) → FS', () => {
  // 2025-04-25 = venerdì
  assert.equal(getDefaultActivity(2025, 4, 25), 'FS');
});

test('1 Gennaio 2022 (sabato, Capodanno) → WE (WE ha priorità su FS)', () => {
  // 2022-01-01 = sabato
  assert.equal(getDefaultActivity(2022, 1, 1), 'WE');
});

test('1 Novembre 2025 (sabato, Tutti i Santi) → WE', () => {
  // 2025-11-01 = sabato
  assert.equal(getDefaultActivity(2025, 11, 1), 'WE');
});
