// src/client/pages/riepilogo.ts
//
// Pagina "Riepilogo" (/riepilogo): cruscotto annuale che AGGREGA i moduli a colpo
// d'occhio (sintesi fiscale, fatturato + limite 85k, prossime scadenze, CTA
// Dichiarazione). Raggiunta dal menu profilo. NON ri-deriva il dettaglio fiscale
// (resta sulla pagina Regime `/`): qui si sintetizza e si linka alle pagine.
//
// Render puri (testabili) + mount con 2 fetch in parallelo. Frontend-only:
// GET /api/tax/scenario (card 1+2) e GET /api/scadenziario/:year (card 3) esistono.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { scadenzaTiming } from '../lib/scadenza-timing';
import type { ScenarioResponse } from './regime';
import type { ScadenziarioView, ScadenziarioRow } from './scadenze';
import type { ForfettarioScenario } from '@server/lib/tax-engine';

// ── selezione pura ──

/**
 * Prossime scadenze da pagare: righe con residuo (`amount.point - paidTotal`) > 0,
 * ordinate per data di scadenza crescente, troncate alle prime `n`.
 */
export function prossimeScadenze(rows: ScadenziarioRow[], n: number): ScadenziarioRow[] {
  return rows
    .filter((r) => r.amount.point - r.paidTotal > 0.005)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, n);
}
