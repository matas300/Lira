import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTheme, setTheme, toggleTheme } from './theme';

function fakeStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test('getTheme: default dark quando storage vuoto', () => {
  assert.equal(getTheme(fakeStore()), 'dark');
});

test('setTheme/getTheme: persiste light', () => {
  const s = fakeStore();
  setTheme('light', s);
  assert.equal(getTheme(s), 'light');
});

test('toggleTheme: alterna e ritorna il nuovo valore', () => {
  const s = fakeStore();
  assert.equal(toggleTheme(s), 'light'); // da dark → light
  assert.equal(toggleTheme(s), 'dark');  // da light → dark
});

test('getTheme: valore sporco nello storage → default dark', () => {
  const s = fakeStore();
  s.setItem('lira_theme', 'banana');
  assert.equal(getTheme(s), 'dark');
});
