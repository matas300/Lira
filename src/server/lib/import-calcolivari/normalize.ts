/** Stringa trimmata, vuoto/null → null. */
export function ns(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** Numero finito, vuoto/non-numerico → null. */
export function nn(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** Booleano CalcoliVari → 0/1. */
export function nb(v: unknown): number {
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

/** Percentuale CalcoliVari (es. 67, 15) → frazione Lira (0.67, 0.15). */
export function pctToFrac(v: unknown): number | null {
  const x = nn(v);
  if (x == null) return null;
  return x > 1 ? x / 100 : x;
}
