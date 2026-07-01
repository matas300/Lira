// src/client/lib/year.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYear, setYear, clampYearToProfile, MIN_YEAR, maxYear } from './year';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

test('getYear: default = anno corrente se storage vuoto', () => {
  const s = fakeStorage();
  assert.equal(getYear(s), new Date().getFullYear());
});

test('setYear/getYear: round-trip', () => {
  const s = fakeStorage();
  setYear(2024, s);
  assert.equal(getYear(s), 2024);
});

test('getYear: clamp sotto il minimo', () => {
  const s = fakeStorage({ lira_year: '1990' });
  assert.equal(getYear(s), MIN_YEAR);
});

test('getYear: clamp sopra il massimo', () => {
  const s = fakeStorage({ lira_year: '3000' });
  assert.equal(getYear(s), maxYear());
});

test('getYear: valore non numerico → default', () => {
  const s = fakeStorage({ lira_year: 'abc' });
  assert.equal(getYear(s), new Date().getFullYear());
});

test('clampYearToProfile: sopra maxYear → aggancia a maxYear', () => {
  const s = fakeStorage({ lira_year: '2026' });
  assert.equal(clampYearToProfile({ minYear: 2023, maxYear: 2025 }, s), true);
  assert.equal(getYear(s), 2025);
});

test('clampYearToProfile: sotto minYear → aggancia a minYear', () => {
  const s = fakeStorage({ lira_year: '2020' });
  assert.equal(clampYearToProfile({ minYear: 2023, maxYear: 2027 }, s), true);
  assert.equal(getYear(s), 2023);
});

test('clampYearToProfile: dentro il range → nessun cambiamento', () => {
  const s = fakeStorage({ lira_year: '2024' });
  assert.equal(clampYearToProfile({ minYear: 2023, maxYear: 2027 }, s), false);
  assert.equal(getYear(s), 2024);
});

test('clampYearToProfile: range nullo (profilo senza anni) → no-op', () => {
  const s = fakeStorage({ lira_year: '2020' });
  assert.equal(clampYearToProfile({ minYear: null, maxYear: null }, s), false);
  assert.equal(getYear(s), 2020);
});
