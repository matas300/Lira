// src/shared/import-fattura.ts
//
// Logica pura per l'import di fatture da XML FatturaPA (Slice 5E).
// Port da CalcoliVari/fatture-import-xml.js. Nessuna dipendenza DOM: il
// DOM-traversal vive in @client/lib/parse-fattura-xml.ts e produce RawFattura.

import { computeImporto } from './fattura-logic';
import type { ImportFatturaInput } from './types';

/** Struttura grezza estratta dall'XML dal parser client (stringhe già trim). */
export interface RawFattura {
  tipoDocumento: string;
  data: string;
  numero: string;
  importoTotale: number;
  bolloImporto: number;
  modalitaPagamento: string;
  /** Identificativi del CedentePrestatore (audit C3): per la verifica server-side fattura attiva vs passiva. */
  cedente?: { partitaIva: string; idPaese: string; codiceFiscale: string };
  cliente: {
    denominazione: string; nome: string; cognome: string;
    partitaIva: string; idPaese: string; idCodice: string; codiceFiscale: string;
    indirizzo: string; cap: string; citta: string; provincia: string; nazione: string;
  };
  righe: Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>;
}

function normU(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

/** Parsa il Numero FatturaPA: '3/2026' | '2026/3' | '42' puro. */
export function parseNumero(numeroXml: string): { progressivo: number; anno: number } {
  const s = String(numeroXml || '').trim();
  let m = s.match(/(\d+)\s*\/\s*(\d{4})$/);
  if (m) return { progressivo: parseInt(m[1]!, 10), anno: parseInt(m[2]!, 10) };
  m = s.match(/(\d{4})\s*\/\s*(\d+)$/);
  if (m) return { anno: parseInt(m[1]!, 10), progressivo: parseInt(m[2]!, 10) };
  m = s.match(/^\d+$/);
  if (m) return { progressivo: parseInt(s, 10), anno: 0 };
  return { progressivo: 0, anno: 0 };
}

/** Ritorna l'id del cliente esistente che matcha (P.IVA → CF), altrimenti null. */
export function matchCliente(
  snapshot: { partitaIva?: string | null; codiceFiscale?: string | null },
  clienti: Array<{ id: string; partitaIva: string | null; codiceFiscale: string | null }>,
): string | null {
  const p = normU(snapshot.partitaIva);
  if (p) { const hit = clienti.find((c) => normU(c.partitaIva) === p); if (hit) return hit.id; }
  const cf = normU(snapshot.codiceFiscale);
  if (cf) { const hit = clienti.find((c) => normU(c.codiceFiscale) === cf); if (hit) return hit.id; }
  return null;
}

/** Chiave di dedup idempotente. TD04 distinto da TD01 a parità di progressivo. */
export function dedupKey(item: { tipoDocumento: string; annoProgressivo: number; progressivo: number; numero: string }): string {
  return `${item.tipoDocumento || 'TD01'}|${item.annoProgressivo || 0}|${item.progressivo || 0}|${item.numero || ''}`;
}

/** Costruisce l'ImportFatturaInput dal RawFattura (numero, righe, snapshot, importo). */
export function buildImportItem(raw: RawFattura): ImportFatturaInput {
  const parsed = parseNumero(raw.numero);
  const annoProgressivo = parsed.anno
    || (raw.data ? parseInt(raw.data.slice(0, 4), 10) : new Date().getFullYear());
  const progressivo = parsed.progressivo || 0;
  const numeroDisplay = progressivo > 0 ? `${annoProgressivo}/${progressivo}` : (raw.numero || `${annoProgressivo}/0`);
  const tipoDocumento = raw.tipoDocumento === 'TD04' ? 'TD04' : 'TD01';

  const righe = raw.righe.length
    ? raw.righe.map((r) => ({
        descrizione: r.descrizione || '(importata)',
        quantita: Math.abs(Number(r.quantita) || 1),
        prezzoUnitario: Math.abs(Number(r.prezzoUnitario) || 0),
      }))
    : [{ descrizione: '(importata senza righe dettaglio)', quantita: 1, prezzoUnitario: Math.abs(raw.importoTotale) }];

  const c = raw.cliente;
  const nome = c.denominazione || `${c.nome} ${c.cognome}`.trim() || '(senza nome)';
  const partitaIva = (c.partitaIva || c.idCodice || '').trim();
  const nazione = (c.nazione || 'IT').toUpperCase();
  const tipoCliente = nazione !== 'IT' ? 'Estero' : (partitaIva ? 'PG' : 'PF');

  // importo: preferiamo l'ImportoTotaleDocumento dell'XML quando presente, così
  // il server può confrontarlo col ricalcolo righe e segnalare divergenze
  // (sconti/maggiorazioni ignorati all'import → warning, audit M14).
  const importoXml = Math.abs(Number(raw.importoTotale) || 0);

  return {
    tipoDocumento,
    numero: raw.numero,
    data: raw.data,
    annoProgressivo,
    progressivo,
    numeroDisplay,
    righe,
    importo: importoXml > 0 ? importoXml : computeImporto(righe),
    marcaDaBollo: raw.bolloImporto > 0,
    modalitaPagamento: raw.modalitaPagamento || null,
    cedentePartitaIva: (raw.cedente?.partitaIva || '').trim() || null,
    cedenteCodiceFiscale: (raw.cedente?.codiceFiscale || '').trim() || null,
    clienteSnapshot: {
      nome,
      tipoCliente,
      partitaIva: partitaIva || null,
      codiceFiscale: (c.codiceFiscale || '').trim() || null,
      codiceSdi: null,
      pec: null,
      indirizzo: (c.indirizzo || '').trim() || null,
      cap: (c.cap || '').trim() || null,
      citta: (c.citta || '').trim() || null,
      provincia: (c.provincia || '').trim() || null,
      nazione,
    },
  };
}
