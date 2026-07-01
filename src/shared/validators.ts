// src/shared/validators.ts
//
// Validatori puri e riusabili per anagrafica clienti (Slice 4A).
// Nessuna dipendenza DOM/DB: usati sia dai refine Zod (shared/schemas)
// sia dalla route, sia dai test in isolamento.

export type TipoCliente = 'PF' | 'PG' | 'PA' | 'Estero';

/**
 * Check-digit ufficiale P.IVA italiana (algoritmo Luhn italiano).
 * - 11 cifre esatte.
 * - Posizioni pari (0-indexed: 0,2,4,6,8) sommate as-is.
 * - Posizioni dispari (0-indexed: 1,3,5,7,9) raddoppiate; se >9 sottrai 9; poi sommate.
 * - check = (10 - (somma % 10)) % 10; valida se uguale alla 11ª cifra (index 10).
 */
export function isValidPartitaIvaIT(piva: string): boolean {
  if (typeof piva !== 'string' || !/^\d{11}$/.test(piva)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = piva.charCodeAt(i) - 48; // '0' === 48
    if (i % 2 === 0) {
      sum += d;
    } else {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  const check = (10 - (sum % 10)) % 10;
  return check === piva.charCodeAt(10) - 48;
}

/** Solo formato: 16 caratteri alfanumerici uppercase. Check-digit fuori scope 4A. */
export function isValidCodiceFiscaleFormat(cf: string): boolean {
  return typeof cf === 'string' && /^[A-Z0-9]{16}$/.test(cf);
}

// Tabelle ufficiali per il carattere di controllo del CF persona fisica
// (D.M. 23/12/1976). Le posizioni DISPARI (1ª, 3ª, …, 1-indexed) usano CF_ODD,
// le PARI usano CF_EVEN; la somma mod 26 mappa in A-Z.
const CF_ODD: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const CF_EVEN: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12,
  N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};

// Posizioni "numeriche" del CF persona fisica: nei codici OMOCODICI (Agenzia
// delle Entrate) le cifre sono sostituite, a partire da destra, con lettere
// L,M,N,P,Q,R,S,T,U,V (0→L, 1→M, … 9→V) per differenziare persone con lo
// stesso codice base. Le tabelle CF_ODD/CF_EVEN già mappano queste lettere, per
// cui il carattere di controllo si calcola sul codice così com'è: basta
// accettarle nel formato. La 8ª posizione (mese) e le posizioni cognome/nome
// restano lettere; il check-char finale è sempre A-Z.
const CF_OMOCODIA = '[0-9LMNPQRSTUV]';
const CF_PF_REGEX = new RegExp(
  `^[A-Z]{6}${CF_OMOCODIA}{2}[A-Z]${CF_OMOCODIA}{2}[A-Z]${CF_OMOCODIA}{3}[A-Z]$`,
);

/**
 * Validazione COMPLETA del codice fiscale (formato + carattere di controllo),
 * fix M4: un CF con check-char errato passa il solo controllo di formato ma può
 * causare lo scarto della fattura da parte di SdI.
 * - Persona fisica: 16 caratteri `LLLLLLNNLNNLNNNL` con check-char verificato;
 *   accetta anche i codici OMOCODICI (lettere al posto delle cifre).
 * - Enti/società: 11 cifre = stessa validazione della P.IVA.
 */
export function isValidCodiceFiscale(cf: string): boolean {
  if (typeof cf !== 'string') return false;
  const v = cf.toUpperCase();
  if (/^\d{11}$/.test(v)) return isValidPartitaIvaIT(v);
  if (!CF_PF_REGEX.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = v[i]!;
    // i è 0-indexed: posizione 1-indexed dispari ⇔ i pari ⇒ CF_ODD.
    sum += (i % 2 === 0 ? CF_ODD : CF_EVEN)[ch]!;
  }
  const expected = String.fromCharCode(65 + (sum % 26));
  return expected === v[15];
}

/**
 * SDI/IPA per tipo cliente:
 * - PA → codice IPA 6 char alfanumerici uppercase.
 * - PF/PG/Estero → 7 char alfanumerici uppercase (default '0000000').
 */
export function isValidCodiceSdi(sdi: string, tipo: TipoCliente): boolean {
  if (typeof sdi !== 'string') return false;
  return tipo === 'PA' ? /^[A-Z0-9]{6}$/.test(sdi) : /^[A-Z0-9]{7}$/.test(sdi);
}

/** PEC: email base. Nullable/opzionale gestito dal chiamante. */
export function isValidPec(pec: string): boolean {
  return typeof pec === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pec);
}
