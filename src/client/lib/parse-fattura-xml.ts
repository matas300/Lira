// src/client/lib/parse-fattura-xml.ts
//
// Parser thin FatturaPA (solo DOMParser, browser). Estrae le stringhe grezze
// in RawFattura; ogni regola (numero, normalizzazioni) sta in @shared.
//
// Audit 2026-06:
//  - estrae anche gli identificativi del CedentePrestatore (C3: il server li
//    confronta col profilo per rifiutare fatture passive importate come attive);
//  - un lotto con più FatturaElettronicaBody produce un RawFattura per body
//    (M13): usare parseFatturaXmlAll. parseFatturaXml resta per compatibilità
//    e ritorna il primo body.

import type { RawFattura } from '@shared/import-fattura';

export class ImportParseError extends Error {}

function text(node: Element | null, tag: string): string {
  if (!node) return '';
  const el = node.getElementsByTagName(tag)[0];
  return el ? String(el.textContent || '').trim() : '';
}

function firstChild(node: Element | Document | null, tag: string): Element | null {
  if (!node) return null;
  return node.getElementsByTagName(tag)[0] ?? null;
}

function num(v: string): number {
  const n = parseFloat(String(v || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parsa un XML FatturaPA in uno o più RawFattura (un item per ogni
 * FatturaElettronicaBody del lotto). Lancia ImportParseError su XML invalido.
 */
export function parseFatturaXmlAll(xmlText: string): RawFattura[] {
  if (typeof xmlText !== 'string' || !xmlText.trim()) throw new ImportParseError('XML vuoto');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror')[0]) throw new ImportParseError('XML non valido');

  const bodies = doc.getElementsByTagName('FatturaElettronicaBody');
  const header = doc.getElementsByTagName('FatturaElettronicaHeader')[0] ?? null;
  if (!bodies.length || !header) throw new ImportParseError('Struttura FatturaElettronica mancante');

  // ── Header (comune a tutti i body del lotto) ──
  const cedp = firstChild(header, 'CedentePrestatore');
  const cedDati = firstChild(cedp, 'DatiAnagrafici');
  const cedIva = firstChild(cedDati, 'IdFiscaleIVA');
  const cedente = {
    partitaIva: text(cedIva, 'IdCodice'),
    idPaese: text(cedIva, 'IdPaese'),
    codiceFiscale: text(cedDati, 'CodiceFiscale'),
  };

  const cess = firstChild(header, 'CessionarioCommittente');
  const cessDati = firstChild(cess, 'DatiAnagrafici');
  const cessAnag = firstChild(cessDati, 'Anagrafica');
  const cessIva = firstChild(cessDati, 'IdFiscaleIVA');
  const cessSede = firstChild(cess, 'Sede');
  const cliente: RawFattura['cliente'] = {
    denominazione: text(cessAnag, 'Denominazione'),
    nome: text(cessAnag, 'Nome'),
    cognome: text(cessAnag, 'Cognome'),
    partitaIva: text(cessIva, 'IdCodice'),
    idPaese: text(cessIva, 'IdPaese'),
    idCodice: text(cessIva, 'IdCodice'),
    codiceFiscale: text(cessDati, 'CodiceFiscale'),
    indirizzo: text(cessSede, 'Indirizzo'),
    cap: text(cessSede, 'CAP'),
    citta: text(cessSede, 'Comune'),
    provincia: text(cessSede, 'Provincia'),
    nazione: text(cessSede, 'Nazione') || 'IT',
  };

  // ── Un RawFattura per ogni body ──
  const out: RawFattura[] = [];
  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b]!;
    const datiGen = firstChild(body, 'DatiGeneraliDocumento');
    if (!datiGen) throw new ImportParseError(`DatiGeneraliDocumento mancante (body ${b + 1})`);

    const datiBollo = firstChild(datiGen, 'DatiBollo');
    const dettPag = firstChild(firstChild(body, 'DatiPagamento'), 'DettaglioPagamento');

    const lineNodes = body.getElementsByTagName('DettaglioLinee');
    const righe: RawFattura['righe'] = [];
    for (let i = 0; i < lineNodes.length; i++) {
      const ln = lineNodes[i]!;
      righe.push({
        descrizione: text(ln, 'Descrizione'),
        quantita: num(text(ln, 'Quantita')) || 1,
        prezzoUnitario: num(text(ln, 'PrezzoUnitario')),
      });
    }

    out.push({
      tipoDocumento: text(datiGen, 'TipoDocumento') || 'TD01',
      data: text(datiGen, 'Data'),
      numero: text(datiGen, 'Numero'),
      importoTotale: num(text(datiGen, 'ImportoTotaleDocumento')),
      bolloImporto: datiBollo ? num(text(datiBollo, 'ImportoBollo')) : 0,
      modalitaPagamento: text(dettPag, 'ModalitaPagamento'),
      cedente,
      cliente,
      righe,
    });
  }
  return out;
}

/** Compat: primo body del lotto. Preferire parseFatturaXmlAll (lotti multi-fattura). */
export function parseFatturaXml(xmlText: string): RawFattura {
  return parseFatturaXmlAll(xmlText)[0]!;
}
