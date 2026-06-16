// src/client/lib/scadenza-timing.ts
//
// Helper puro per calcolare lo "stato temporale" di una scadenza fiscale rispetto
// a una data di riferimento (parametro, per testabilità — niente Date.now interno).
//
// Usato da `pages/scadenze.ts` per mostrare il chip timing nelle righe.

export interface ScadenzaTimingResult {
  state: 'scaduta' | 'imminente' | 'futura';
  label: string;
  tone: 'danger' | 'warn' | 'ok';
}

/**
 * Calcola stato temporale di una scadenza.
 *
 * @param dueDateIso - Data di scadenza ISO (YYYY-MM-DD).
 * @param today      - Data di riferimento ISO (YYYY-MM-DD) — non usare Date.now internamente.
 * @returns { state, label, tone }
 */
export function scadenzaTiming(dueDateIso: string, today: string): ScadenzaTimingResult {
  // Parsare solo la parte data (no ora) per evitare drift timezone.
  const [dy, dm, dd] = dueDateIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const due = new Date(dy, dm - 1, dd);
  const ref = new Date(ty, tm - 1, td);

  // Giorni di differenza (positivo = nel futuro).
  const diffMs = due.getTime() - ref.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { state: 'scaduta', label: 'Scaduta', tone: 'danger' };
  }
  if (diffDays === 0) {
    return { state: 'imminente', label: 'Oggi', tone: 'warn' };
  }
  if (diffDays <= 30) {
    return { state: 'imminente', label: `Tra ${diffDays}g`, tone: 'warn' };
  }
  // Futura: mostra la data in formato italiano leggibile.
  const label = due.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  return { state: 'futura', label, tone: 'ok' };
}
