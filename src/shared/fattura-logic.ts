// src/shared/fattura-logic.ts
//
// Logica fiscale pura e riusabile per le fatture (Slice 5A). Nessuna
// dipendenza DOM/DB: usata dai refine Zod, dalla route e dai test.

import { isValidPartitaIvaIT, isValidCodiceFiscaleFormat } from './validators';

export interface RigaLike {
  descrizione?: string;
  quantita: number;
  prezzoUnitario: number;
}

export interface ClienteSnapshotLike {
  nazione?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
}

/** Soglia marca da bollo per operazioni esenti/non imponibili (art. 6 DM 17/06/2014). */
export const SOGLIA_BOLLO = 77.47;

/**
 * Soglia di USCITA IMMEDIATA dal forfettario (L. 197/2022, art. 1 c. 71):
 * oltre 100.000 € di ricavi/compensi percepiti nell'anno il regime cessa
 * subito e l'IVA è dovuta a partire dall'operazione che eccede la soglia.
 */
export const SOGLIA_USCITA_FORFETTARIO = 100_000;

export const MSG_RITENUTA_FORFETTARIO =
  "Il regime forfettario è esonerato dalla ritenuta d'acconto (art. 1 c. 67 L. 190/2014). " +
  'Rimuovere la ritenuta dalla fattura.';

export const MSG_CLIENTE_IT =
  'Cliente IT deve avere almeno la P.IVA o il Codice Fiscale (FatturaPA v1.2 §1.4.1.2).';

/**
 * Dicitura legale obbligatoria del regime forfettario (operazione in franchigia
 * IVA e senza ritenuta d'acconto, art. 1 c. 54-89 L. 190/2014). UNICA fonte di
 * verità: usata sia come RiferimentoNormativo nell'XML sia come footer legale
 * del PDF, così le due rappresentazioni non possono divergere.
 */
export const DICITURA_FORFETTARIO =
  "Regime forfettario: operazione in franchigia IVA e senza ritenuta d'acconto Art.1 c.54-89 L.190/2014";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeRigaTotale(riga: RigaLike): number {
  const q = Number(riga.quantita) || 0;
  const p = Number(riga.prezzoUnitario) || 0;
  return round2(q * p);
}

export function computeImporto(righe: RigaLike[]): number {
  let sum = 0;
  for (const r of righe) sum += Number(r.quantita || 0) * Number(r.prezzoUnitario || 0);
  return round2(sum);
}

/**
 * Bollo dovuto solo in regime forfettario quando l'imponibile esente supera 77,47 €.
 *
 * Policy NC (audit 2026-06): NIENTE bollo sulle note di credito TD04 — l'XML
 * TD04 non emette DatiBollo, quindi marcarlo a DB creerebbe un'incoerenza
 * DB↔XML; la NC storna corrispettivi già assoggettati, non ne crea di nuovi.
 */
export function isBolloDovuto(regime: string, imponibileEsente: number, tipoDocumento: string = 'TD01'): boolean {
  if (tipoDocumento === 'TD04') return false;
  return regime === 'forfettario' && imponibileEsente > SOGLIA_BOLLO;
}

/** Ritorna messaggio errore o null. Forfettario + ritenuta>0 → vietato. */
export function validateRitenutaForfettario(regime: string, ritenuta: number): string | null {
  if (regime !== 'forfettario') return null;
  return Number(ritenuta) > 0 ? MSG_RITENUTA_FORFETTARIO : null;
}

/** Ritorna messaggio errore o null. Cliente IT senza P.IVA né CF → vietato. */
export function validateClienteSnapshot(snap: ClienteSnapshotLike | null | undefined): string | null {
  if (!snap) return null;
  const nazione = String(snap.nazione || 'IT').toUpperCase();
  if (nazione !== 'IT') return null;
  const piva = String(snap.partitaIva || '').replace(/\s+/g, '');
  const cf = String(snap.codiceFiscale || '').trim().toUpperCase();
  const hasPiva = piva.length > 0 && isValidPartitaIvaIT(piva);
  const hasCf = cf.length > 0 && isValidCodiceFiscaleFormat(cf);
  return hasPiva || hasCf ? null : MSG_CLIENTE_IT;
}
