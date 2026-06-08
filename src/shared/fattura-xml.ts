// src/shared/fattura-xml.ts
//
// Generatore FatturaPA v1.2 (TD01) puro — port audit-hardened da CalcoliVari
// (fatture-xml-helpers.js + fatture-docs-feature.js). Nessuna dipendenza DOM/DB.
// Solo TD01 (no note di credito): importi sempre positivi.

import { SOGLIA_BOLLO } from './fattura-logic';
import { isValidPartitaIvaIT, isValidCodiceFiscaleFormat } from './validators';
import type { Cedente } from './cedente';

export const XML_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';

/** Escape XML (apostrofo -> &apos;, come html-utils.xmlEscape). */
export function xmlEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function fmtXmlNum(n: number): string {
  return round2(Number(n) || 0).toFixed(2);
}

export function parseMaybeNumber(value: unknown): number {
  const n = parseFloat(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Conformita' XSD String*LatinType (Basic Latin + Latin-1 Supplement). NFC +
 * mappatura smart-quotes/dash/euro/ellissi -> ASCII/Latin-1; strip del resto
 * (control chars tranne \t \n \r, CJK, emoji). Tutte le classi usano \u-escape
 * per mantenere il sorgente ASCII-puro.
 */
export function sanitizeXmlLatin1(value: unknown): string {
  if (value == null) return '';
  let str = String(value);
  if (typeof str.normalize === 'function') str = str.normalize('NFC');
  return str
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // control chars (keep \t \n \r)
    .replace(/[‘’‚‛′]/g, "'")        // smart single quotes / prime
    .replace(/[“”„‟″]/g, '"')        // smart double quotes
    .replace(/[‐‑‒–—―]/g, '-')  // hyphens / dashes
    .replace(/…/g, '...')                                // ellipsis
    .replace(/€/g, 'EUR')                                // euro sign
    .replace(/•/g, '-')                                  // bullet
    .replace(/™/g, '(TM)')                               // trademark
    .replace(/[^\u0000-\u00FF]/g, ''); // strip rest (CJK, emoji)
}

/** ProgressivoInvio: <=10 char alfanumerici (FatturaPA 1.1.2). */
export function sanitizeProgressivoInvio(value: unknown): string {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || '00001';
}

const MODALITA_TO_MP: Record<string, string> = {
  'bonifico': 'MP05', 'bonifico bancario': 'MP05', 'assegno': 'MP01',
  'assegno circolare': 'MP02', 'contanti': 'MP10', 'carta di credito': 'MP08',
  'carta': 'MP08', 'paypal': 'MP08', 'rid': 'MP09', 'sepa': 'MP15',
  'giroconto': 'MP06', 'compensazione': 'MP07',
};

/** Stringa libera -> codice ModalitaPagamento (default MP05 bonifico). */
export function modalitaToCodiceMP(str: unknown): string {
  const key = String(str || '').toLowerCase().trim();
  for (const k of Object.keys(MODALITA_TO_MP)) {
    if (key.indexOf(k) !== -1) return MODALITA_TO_MP[k]!;
  }
  return 'MP05';
}

export function regimeToRF(regime: string): 'RF19' | 'RF01' {
  return regime === 'ordinario' ? 'RF01' : 'RF19';
}

/**
 * Anagrafica cessionario. Lo snapshot Lira ha solo `nome` (denominazione o
 * nome+cognome gia' concatenati) -> emettiamo sempre <Denominazione>.
 */
export function buildAnagraficaCessionario(cliente: { nome?: string | null }): string {
  const denom = sanitizeXmlLatin1(cliente?.nome || '').trim().slice(0, 80);
  return '<Denominazione>' + xmlEscape(denom) + '</Denominazione>';
}

export { SOGLIA_BOLLO };

// ───── Tipi input + validazione fattura per XML ─────

export interface ClienteSnapshotXml {
  nome?: string | null;
  tipoCliente?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
  codiceSdi?: string | null;
  pec?: string | null;
  indirizzo?: string | null;
  cap?: string | null;
  citta?: string | null;
  provincia?: string | null;
  nazione?: string | null;
}

export interface FatturaXmlInput {
  cedente: Cedente;
  cliente: ClienteSnapshotXml;
  numero: string;
  data: string;
  righe: Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>;
  importo: number;
  ritenuta: number;
  aliquotaRitenuta: number | null;
  tipoRitenuta: string | null;
  causaleRitenuta: string | null;
  marcaDaBollo: boolean;
  bolloAddebitato: boolean;
  modalitaPagamento: string | null;
  contributoIntegrativo: number;
}

/** Helper stringa locale (trim, null-safe). Usato da validate + builder. */
function s(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Validazione fail-fast della fattura per l'XML. Ritorna [] se ok. */
export function validateFatturaForXml(input: FatturaXmlInput): string[] {
  const errors: string[] = [];
  if (!input.numero) errors.push('Numero fattura mancante (la fattura deve essere inviata).');
  if (!input.data) errors.push('Data fattura mancante.');
  if (!(Number(input.importo) > 0)) errors.push('Importo totale della fattura pari a zero.');
  if (Number(input.contributoIntegrativo) > 0) {
    errors.push('Contributo integrativo non supportato in XML (gestione separata INPS non lo prevede): azzera il campo.');
  }
  if (input.cedente.regime === 'forfettario' && Number(input.ritenuta) > 0) {
    errors.push('Regime forfettario esonerato dalla ritenuta d\'acconto (art. 1 c. 67 L. 190/2014): rimuovi la ritenuta.');
  }
  const c = input.cliente;
  if (!c || !s(c.nome)) {
    errors.push('Cliente senza denominazione.');
  } else {
    if (!s(c.indirizzo)) errors.push('Indirizzo del cliente mancante.');
    if (!s(c.cap)) errors.push('CAP del cliente mancante.');
    if (!s(c.citta)) errors.push('Comune del cliente mancante.');
    const naz = (s(c.nazione) || 'IT').toUpperCase();
    if (naz === 'IT') {
      const hasPiva = isValidPartitaIvaIT(s(c.partitaIva).replace(/\s+/g, ''));
      const hasCf = isValidCodiceFiscaleFormat(s(c.codiceFiscale).toUpperCase());
      if (!hasPiva && !hasCf) errors.push('Cliente IT senza P.IVA valida né Codice Fiscale: SdI rifiuterà l\'XML.');
    }
    if (c.tipoCliente === 'PA' && !/^[A-Z0-9]{6}$/i.test(s(c.codiceSdi))) {
      errors.push('Cliente PA: il Codice IPA deve essere 6 caratteri alfanumerici (D.M. 55/2013 art. 2).');
    }
  }
  return errors;
}
