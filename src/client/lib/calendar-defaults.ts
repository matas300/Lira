// src/client/lib/calendar-defaults.ts
//
// Default activity code per un giorno del calendario, port fedele di CalcoliVari:
//   - app.js getDefaultActivity (riga ~840): controlla prima weekend (dow 0/6 → 'WE'),
//     poi festività italiane (isHoliday → 'FS'), altrimenti '8'.
//   - date-utils.js: algoritmo Meeus/Jones/Butcher per Pasqua; lista festività fisse.
//
// Solo override (codici ≠ default) vengono salvati nel DB; il default è calcolato
// client-side senza round-trip.
//
// Esportato come funzioni PURE (no side effect, no globali).

// Festività nazionali italiane fisse [mese, giorno]
// Stessa lista di CalcoliVari date-utils.js
const HOLIDAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],   // Capodanno
  [1, 6],   // Epifania
  [4, 25],  // Liberazione
  [5, 1],   // Festa del Lavoro
  [6, 2],   // Festa della Repubblica
  [8, 15],  // Ferragosto
  [11, 1],  // Tutti i Santi
  [12, 8],  // Immacolata
  [12, 25], // Natale
  [12, 26], // Santo Stefano
];

/**
 * Calcola la data di Pasqua per un dato anno (algoritmo Meeus/Jones/Butcher).
 * Port fedele di CalcoliVari date-utils.js `getEaster`.
 * Ritorna [mese, giorno] (1-based).
 */
export function getEaster(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/**
 * Verifica se il giorno è una festività nazionale italiana.
 * Port fedele di CalcoliVari date-utils.js `isHoliday`.
 * Include Pasqua (domenica) + Pasquetta (lunedì dopo Pasqua).
 */
export function isItalianHoliday(year: number, month: number, day: number): boolean {
  // Festività fisse
  for (const [hm, hd] of HOLIDAYS) {
    if (hm === month && hd === day) return true;
  }
  // Pasqua
  const [em, ed] = getEaster(year);
  if (month === em && day === ed) return true;
  // Pasquetta (lunedì dopo Pasqua)
  const pasquetta = new Date(year, em - 1, ed);
  pasquetta.setDate(pasquetta.getDate() + 1);
  if (month === pasquetta.getMonth() + 1 && day === pasquetta.getDate()) return true;
  return false;
}

/**
 * Codice attività di default per un giorno.
 * Port fedele di CalcoliVari app.js `getDefaultActivity`.
 * Ordine: weekend (sab/dom) → 'WE'; festività → 'FS'; altrimenti → '8'.
 * WE ha PRIORITÀ su FS: un festivo che cade di weekend torna 'WE'.
 */
export function getDefaultActivity(year: number, month: number, day: number): '8' | 'WE' | 'FS' {
  const d = new Date(year, month - 1, day);
  const dow = d.getDay(); // 0=domenica, 6=sabato
  if (dow === 0 || dow === 6) return 'WE';
  if (isItalianHoliday(year, month, day)) return 'FS';
  return '8';
}
