// Date helpers per scadenze fiscali italiane: slittamento al primo giorno
// lavorativo successivo (DPR 558/1999 art. 1), riconoscimento festività
// nazionali fisse + Pasquetta (mobile).
//
// Tutte le operazioni di calendario usano `Date.UTC` per evitare shift di
// timezone (DST, locale). L'input/output è sempre ISO `YYYY-MM-DD`.
//
// FIX C3 (audit 25/05/2026): `buildRolledDueDate` viene applicato
// uniformemente a TUTTE le scadenze fiscali, inclusa 28/02 (bollo Q4 e
// INPS fissi rata 4). Nessun codepath bypassa il rolling.

// Festività nazionali fisse italiane in formato `MM-DD`.
// Pasquetta è mobile e calcolata a parte via Gauss anonymous Gregorian.
const FESTIVI_FISSI: ReadonlySet<string> = new Set([
  '01-01', // Capodanno
  '01-06', // Epifania
  '04-25', // Liberazione
  '05-01', // Festa del Lavoro
  '06-02', // Festa della Repubblica
  '08-15', // Ferragosto
  '11-01', // Tutti i Santi
  '12-08', // Immacolata
  '12-25', // Natale
  '12-26', // Santo Stefano
]);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Parsea un ISO `YYYY-MM-DD` in componenti numerici, validando lo shape.
// Ritorna `null` se la stringa non rispetta il formato o se i valori non
// corrispondono a una data reale (es. 2025-02-30).
function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const day = parseInt(m[3]!, 10);
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Algoritmo Gauss/Meeus anonymous Gregorian. Ritorna mese e giorno della
// Domenica di Pasqua per l'anno indicato (calendario gregoriano).
function calcolaPasqua(year: number): { month: number; day: number } {
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
  return { month, day };
}

/**
 * Ritorna l'ISO date (`YYYY-MM-DD`) di Pasquetta (lunedì dell'Angelo) per
 * l'anno indicato: Pasqua + 1 giorno. Pasquetta è festività nazionale ma
 * mobile, quindi non è in `FESTIVI_FISSI`.
 *
 * Esempi:
 * - 2026 → '2026-04-06' (Pasqua 5 aprile)
 * - 2025 → '2025-04-21' (Pasqua 20 aprile)
 */
export function calcolaPasquetta(year: number): string {
  const pasqua = calcolaPasqua(year);
  const utc = Date.UTC(year, pasqua.month - 1, pasqua.day + 1);
  return toIso(new Date(utc));
}

/**
 * Verifica se una data ISO è festività nazionale italiana (fissa o
 * Pasquetta). Le domeniche NON sono considerate festività da questa
 * funzione: il rolling al primo giorno lavorativo le gestisce
 * separatamente come weekend.
 *
 * Festività fisse coperte: 01/01, 06/01, 25/04, 01/05, 02/06, 15/08,
 * 01/11, 08/12, 25/12, 26/12. Più Pasquetta (variabile).
 */
export function isItalianHoliday(iso: string): boolean {
  const parts = parseIso(iso);
  if (!parts) return false;
  const key = `${pad2(parts.month)}-${pad2(parts.day)}`;
  if (FESTIVI_FISSI.has(key)) return true;
  return calcolaPasquetta(parts.year) === iso;
}

/**
 * Slittamento al primo giorno lavorativo successivo (DPR 558/1999 art. 1).
 * Se la data ISO ricade in sabato, domenica o festività nazionale, avanza
 * giorno per giorno fino al primo feriale non festivo.
 *
 * FIX C3 (audit): applicato uniformemente a TUTTE le scadenze fiscali,
 * inclusa 28/02 (bollo Q4, INPS fissi Q4). Nessun codepath dovrebbe
 * bypassare questa funzione per regole "speciali".
 *
 * Esempi:
 * - '2026-06-30' (martedì) → `{ date: '2026-06-30', rolled: false }`
 * - '2024-06-30' (domenica) → `{ date: '2024-07-01', rolled: true }`
 * - '2026-02-28' (sabato) → `{ date: '2026-03-02', rolled: true }`
 *
 * Input non valido (formato non ISO o data inesistente) → ritorna l'input
 * con `rolled: false`. I caller dovrebbero validare prima via Zod.
 */
export function buildRolledDueDate(iso: string): { date: string; rolled: boolean } {
  const parts = parseIso(iso);
  if (!parts) return { date: iso, rolled: false };
  let utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let rolled = false;
  while (true) {
    const d = new Date(utc);
    const dow = d.getUTCDay(); // 0=domenica, 6=sabato
    const currentIso = toIso(d);
    if (dow !== 0 && dow !== 6 && !isItalianHoliday(currentIso)) {
      return { date: currentIso, rolled };
    }
    rolled = true;
    utc += 86400000; // +1 giorno (UTC, immune a DST)
  }
}
