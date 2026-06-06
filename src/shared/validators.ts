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
