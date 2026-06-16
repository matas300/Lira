// src/client/lib/calendar-stats.ts
//
// Pure helper: dato un anno e la mappa degli override (keyed "month-day", es. "1-7"),
// conta per ogni mese quante giornate intere lavorate (code === '8')
// e quante mezze giornate (code === 'M'), usando getDefaultActivity per i giorni
// senza override.
//
// Usato dal flusso "Da calendario" della pagina Fatture.

import { getDefaultActivity } from './calendar-defaults';

export interface MonthStat {
  month: number;   // 1-12
  worked: number;  // giorni con effectiveCode === '8'
  half: number;    // giorni con effectiveCode === 'M'
}

/**
 * Calcola le statistiche di lavoro mensili per l'anno dato.
 * @param year    Anno solare.
 * @param overrides  Map<"month-day", activityCode> (solo i giorni modificati).
 * @returns Array di 12 MonthStat, month 1..12.
 */
export function monthlyWorkStats(year: number, overrides: Map<string, string>): MonthStat[] {
  const result: MonthStat[] = [];

  for (let month = 1; month <= 12; month++) {
    let worked = 0;
    let half = 0;

    // Numero di giorni nel mese
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${month}-${day}`;
      const effectiveCode = overrides.get(key) ?? getDefaultActivity(year, month, day);
      if (effectiveCode === '8') worked++;
      else if (effectiveCode === 'M') half++;
    }

    result.push({ month, worked, half });
  }

  return result;
}
