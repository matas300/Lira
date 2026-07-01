// src/client/lib/year.ts
// Anno selezionato: UI-state (ammesso da CLAUDE.md), MAI dati di dominio.
// Storage iniettabile per i test; in app usa localStorage.

const KEY = 'lira_year';
export const MIN_YEAR = 2017;
export function maxYear(): number { return new Date().getFullYear() + 1; }

interface SimpleStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; }
function store(s?: SimpleStorage): SimpleStorage {
  return s ?? (globalThis as unknown as { localStorage: SimpleStorage }).localStorage;
}
function clamp(y: number): number { return Math.min(maxYear(), Math.max(MIN_YEAR, y)); }

export function getYear(s?: SimpleStorage): number {
  const raw = store(s).getItem(KEY);
  const n = raw == null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return new Date().getFullYear();
  return clamp(n);
}

export function setYear(y: number, s?: SimpleStorage): void {
  store(s).setItem(KEY, String(clamp(y)));
}

/**
 * Aggancia l'anno selezionato al range [minYear, maxYear] del profilo attivo,
 * se noto: evita di restare su un anno non configurato dopo lo switch profilo
 * (il selettore anno è UI-state condivisa fra i profili). Ritorna `true` se
 * l'anno è stato modificato. Con range nullo (profilo senza year_settings) non
 * fa nulla — ci pensa il carry-forward / la schermata di configurazione.
 */
export function clampYearToProfile(
  range: { minYear?: number | null; maxYear?: number | null },
  s?: SimpleStorage,
): boolean {
  const cur = getYear(s);
  let next = cur;
  if (range.maxYear != null && next > range.maxYear) next = range.maxYear;
  if (range.minYear != null && next < range.minYear) next = range.minYear;
  if (next === cur) return false;
  setYear(next, s);
  return true;
}
