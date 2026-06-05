// src/server/lib/tax-engine.ts
// Motore fiscale puro: funzioni senza IO, senza Date.now(), senza Math.random().
// Server-authoritative (vedi CLAUDE.md §Architettura) — il client può precalcolare,
// ma la verità fiscale risiede qui.
import { ACCONTO_RULES, type AccontoRules } from '@shared/acconto-rules';

export interface AccontoPlan {
  base: number;
  total: number;
  first: number;
  second: number;
  mode: 'none' | 'single' | 'double';
}

/**
 * Costruisce il piano acconti secondo art. 17 c. 3 DPR 435/2001.
 *
 * - imposta ≤ 51,65 €  → nessun acconto
 * - imposta ≤ 257,52 € → unico versamento a novembre (100%)
 * - imposta >  257,52 € → due rate (40% giugno + 60% novembre)
 *
 * Le soglie sono in `ACCONTO_RULES` (@shared/acconto-rules) per evitare magic numbers.
 */
export function buildAccontoPlan(baseAmount: number, rules?: AccontoRules): AccontoPlan {
  const cfg = rules ?? ACCONTO_RULES;
  const base = ceil2(baseAmount);

  if (base <= cfg.thresholdZero) {
    return { base, total: 0, first: 0, second: 0, mode: 'none' };
  }

  if (base <= cfg.thresholdSingle) {
    return { base, total: base, first: 0, second: base, mode: 'single' };
  }

  const parts = splitByWeights(base, cfg.weights);
  return {
    base,
    total: base,
    first: parts[0] ?? 0,
    second: parts[1] ?? 0,
    mode: 'double',
  };
}

// --- Helpers privati (non esportati) -------------------------------------

function ceil2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Divide `amount` per i `weights` proporzionalmente, con compensazione sull'ultima
 * porzione per garantire `sum(parts) === ceil2(amount)` (no rounding loss).
 */
function splitByWeights(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];

  const total = ceil2(amount);
  const sumWeights = weights.reduce((s, w) => s + w, 0);
  if (sumWeights === 0) return weights.map(() => 0);

  const parts: number[] = [];
  let assigned = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (i === weights.length - 1) {
      parts.push(ceil2(total - assigned));
    } else {
      const portion = ceil2((total * w) / sumWeights);
      parts.push(portion);
      assigned = ceil2(assigned + portion);
    }
  }
  return parts;
}
