// src/client/lib/year.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getYear, setYear, MIN_YEAR, maxYear } from './year';

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
