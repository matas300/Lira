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

// ───── Builder XML TD01 ─────

function buildDettaglioLinee(input: FatturaXmlInput): { linee: string[]; rimborsoBollo: boolean } {
  let n = 0;
  const linee = input.righe.map((line) => {
    n++;
    const qta = parseMaybeNumber(line.quantita) || 1;
    const pu = round2(parseMaybeNumber(line.prezzoUnitario));
    const tot = round2(qta * pu);
    const desc = sanitizeXmlLatin1(line.descrizione || 'Prestazione professionale').slice(0, 1000);
    return '    <DettaglioLinee>\n'
      + '      <NumeroLinea>' + n + '</NumeroLinea>\n'
      + '      <Descrizione>' + xmlEscape(desc) + '</Descrizione>\n'
      + '      <Quantita>' + fmtXmlNum(qta) + '</Quantita>\n'
      + '      <PrezzoUnitario>' + fmtXmlNum(pu) + '</PrezzoUnitario>\n'
      + '      <PrezzoTotale>' + fmtXmlNum(tot) + '</PrezzoTotale>\n'
      + '      <AliquotaIVA>0.00</AliquotaIVA>\n'
      + '      <Natura>N2.2</Natura>\n'
      + '    </DettaglioLinee>';
  });
  const rimborsoBollo = input.marcaDaBollo && input.bolloAddebitato && round2(input.importo) > SOGLIA_BOLLO;
  if (rimborsoBollo) {
    n++;
    linee.push('    <DettaglioLinee>\n'
      + '      <NumeroLinea>' + n + '</NumeroLinea>\n'
      + '      <Descrizione>Rimborso imposta di bollo</Descrizione>\n'
      + '      <Quantita>1.00</Quantita>\n'
      + '      <PrezzoUnitario>2.00</PrezzoUnitario>\n'
      + '      <PrezzoTotale>2.00</PrezzoTotale>\n'
      + '      <AliquotaIVA>0.00</AliquotaIVA>\n'
      + '      <Natura>N1</Natura>\n'
      + '    </DettaglioLinee>');
  }
  return { linee, rimborsoBollo };
}

function buildCessionarioFiscale(c: ClienteSnapshotXml): string {
  const naz = (s(c.nazione) || 'IT').slice(0, 2).toUpperCase();
  const estero = naz !== 'IT';
  const pivaRaw = s(c.partitaIva).replace(/\s+/g, '');
  const cf = s(c.codiceFiscale).toUpperCase();
  if (estero) {
    const vat = (pivaRaw || cf);
    if (!vat) return '';
    const codice = vat.replace(new RegExp('^' + naz, 'i'), '').trim() || vat;
    return '\n        <IdFiscaleIVA>\n          <IdPaese>' + naz + '</IdPaese>\n          <IdCodice>'
      + xmlEscape(codice) + '</IdCodice>\n        </IdFiscaleIVA>';
  }
  if (isValidPartitaIvaIT(pivaRaw)) {
    let out = '\n        <IdFiscaleIVA>\n          <IdPaese>IT</IdPaese>\n          <IdCodice>'
      + xmlEscape(pivaRaw) + '</IdCodice>\n        </IdFiscaleIVA>';
    if (cf) out += '\n        <CodiceFiscale>' + xmlEscape(cf) + '</CodiceFiscale>';
    return out;
  }
  if (!cf) return '';
  return '\n        <CodiceFiscale>' + xmlEscape(cf) + '</CodiceFiscale>';
}

/** Genera l'XML FatturaPA v1.2 TD01. Assume input gia' validato (validateFatturaForXml). */
export function buildFatturaXml(input: FatturaXmlInput): string {
  const ced = input.cedente;
  const c = input.cliente;
  const regimeFiscale = regimeToRF(ced.regime);
  const progressivo = sanitizeProgressivoInvio(input.numero);
  const piva = s(ced.partitaIva).replace(/\s+/g, '');

  // IdTrasmittente.IdCodice: per persona fisica (CF 16 char) usa il CF, non la
  // P.IVA (SdI scarta con 00300). Per PG il CF coincide con la P.IVA.
  const cf = s(ced.codiceFiscale).toUpperCase();
  const isPF = /^[A-Z0-9]{16}$/.test(cf);
  const trasmittenteIdCodice = isPF ? cf : piva;

  const naz = (s(c.nazione) || 'IT').slice(0, 2).toUpperCase();
  const estero = naz !== 'IT';
  const isPA = c.tipoCliente === 'PA';
  const pivaCli = s(c.partitaIva).replace(/\s+/g, '');
  const codiceSDI = estero
    ? 'XXXXXXX'
    : (isPA
        ? s(c.codiceSdi).toUpperCase()
        : (isValidPartitaIvaIT(pivaCli)
            ? (s(c.codiceSdi) || '0000000').padEnd(7, '0').slice(0, 7)
            : (s(c.codiceSdi) || '0000000')));

  const imponibile = round2(input.importo);
  const naturaLinea = 'N2.2';
  const riferimentoNormativo = "Regime forfettario: operazione in franchigia IVA e senza ritenuta d'acconto Art.1 c.54-89 L.190/2014";

  const { linee, rimborsoBollo } = buildDettaglioLinee(input);

  const datiBollo = (input.marcaDaBollo && imponibile > SOGLIA_BOLLO)
    ? '\n      <DatiBollo>\n        <BolloVirtuale>SI</BolloVirtuale>\n        <ImportoBollo>2.00</ImportoBollo>\n      </DatiBollo>'
    : '';

  // DatiGeneraliDocumento — ordine XSD: TipoDocumento, Divisa, Data, Numero, DatiBollo, ImportoTotaleDocumento
  const importoTotale = round2(input.importo + (rimborsoBollo ? 2 : 0));
  const dggParts: string[] = [];
  dggParts.push('<TipoDocumento>TD01</TipoDocumento>');
  dggParts.push('<Divisa>EUR</Divisa>');
  dggParts.push('<Data>' + xmlEscape(input.data) + '</Data>');
  dggParts.push('<Numero>' + xmlEscape(input.numero) + '</Numero>');
  if (datiBollo.trim()) dggParts.push(datiBollo.trim());
  dggParts.push('<ImportoTotaleDocumento>' + fmtXmlNum(importoTotale) + '</ImportoTotaleDocumento>');
  const datiGeneraliDocumentoXml = '<DatiGeneraliDocumento>' + dggParts.join('') + '</DatiGeneraliDocumento>';

  const cessionarioFiscaleXml = buildCessionarioFiscale(c);

  const cedInd = xmlEscape(sanitizeXmlLatin1(ced.indirizzo).slice(0, 60));
  const cedCap = s(ced.cap).replace(/\D/g, '').padStart(5, '0').slice(0, 5);
  const cedCom = xmlEscape(sanitizeXmlLatin1(ced.comune).slice(0, 60));
  const cedProv = s(ced.provincia).slice(0, 2).toUpperCase();
  const cedProvXml = cedProv ? '\n        <Provincia>' + xmlEscape(cedProv) + '</Provincia>' : '';
  const cfCedenteXml = cf ? '\n        <CodiceFiscale>' + xmlEscape(cf) + '</CodiceFiscale>' : '';

  const cliInd = xmlEscape(sanitizeXmlLatin1(c.indirizzo || '').slice(0, 60));
  const cliCap = estero
    ? (s(c.cap).replace(/\D/g, '').padStart(5, '0').slice(0, 5) || '00000')
    : s(c.cap).replace(/\D/g, '').padStart(5, '0').slice(0, 5);
  const cliCom = xmlEscape(sanitizeXmlLatin1(c.citta || '').slice(0, 60));
  const cliProv = estero ? '' : s(c.provincia).slice(0, 2).toUpperCase();
  const cliProvXml = cliProv ? '\n        <Provincia>' + xmlEscape(cliProv) + '</Provincia>' : '';

  const datiPagamento = estero ? '' : `
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>${modalitaToCodiceMP(input.modalitaPagamento)}</ModalitaPagamento>
        <ImportoPagamento>${fmtXmlNum(round2(importoTotale - (Number(input.ritenuta) || 0)))}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12"
  xmlns:p="${XML_NAMESPACE}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${XML_NAMESPACE} http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${xmlEscape(trasmittenteIdCodice)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${progressivo}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${codiceSDI}</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${xmlEscape(piva)}</IdCodice>
        </IdFiscaleIVA>${cfCedenteXml}
        <Anagrafica>
          <Nome>${xmlEscape(sanitizeXmlLatin1(ced.nome).slice(0, 60))}</Nome>
          <Cognome>${xmlEscape(sanitizeXmlLatin1(ced.cognome).slice(0, 60))}</Cognome>
        </Anagrafica>
        <RegimeFiscale>${regimeFiscale}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${cedInd}</Indirizzo>
        <CAP>${cedCap}</CAP>
        <Comune>${cedCom}</Comune>${cedProvXml}
        <Nazione>${ced.nazione}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>${cessionarioFiscaleXml}
        <Anagrafica>
          ${buildAnagraficaCessionario(c)}
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${cliInd}</Indirizzo>
        <CAP>${cliCap}</CAP>
        <Comune>${cliCom}</Comune>${cliProvXml}
        <Nazione>${naz}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      ${datiGeneraliDocumentoXml}
    </DatiGenerali>
    <DatiBeniServizi>
${linee.join('\n')}
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>${naturaLinea}</Natura>
        <ImponibileImporto>${fmtXmlNum(imponibile)}</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>${xmlEscape(riferimentoNormativo)}</RiferimentoNormativo>
      </DatiRiepilogo>${rimborsoBollo ? `
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N1</Natura>
        <ImponibileImporto>2.00</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>Rimborso imposta di bollo - Escluso art. 15 DPR 633/72 (Ris. AdE 444/E 2008)</RiferimentoNormativo>
      </DatiRiepilogo>` : ''}
    </DatiBeniServizi>${datiPagamento}
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}
