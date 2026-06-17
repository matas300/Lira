// src/client/lib/theme.ts
// Tema dark/light: UI-state (ammesso da CLAUDE.md), MAI dati di dominio.
// Storage iniettabile per i test; applica via document.documentElement.dataset.theme.
// I token light vivono in styles/tokens.css (html[data-theme="light"]).

export type Theme = 'dark' | 'light';
const KEY = 'lira_theme';

interface SimpleStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; }
function store(s?: SimpleStorage): SimpleStorage {
  return s ?? (globalThis as unknown as { localStorage: SimpleStorage }).localStorage;
}

export function getTheme(s?: SimpleStorage): Theme {
  return store(s).getItem(KEY) === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme, s?: SimpleStorage): void {
  store(s).setItem(KEY, theme);
}

export function toggleTheme(s?: SimpleStorage): Theme {
  const next: Theme = getTheme(s) === 'dark' ? 'light' : 'dark';
  setTheme(next, s);
  return next;
}

/** Applica il tema corrente al documento (no-op se non c'è document, es. test). */
export function applyTheme(s?: SimpleStorage): void {
  const doc = (globalThis as unknown as { document?: { documentElement: { dataset: Record<string, string> } } }).document;
  if (doc) doc.documentElement.dataset['theme'] = getTheme(s);
}
