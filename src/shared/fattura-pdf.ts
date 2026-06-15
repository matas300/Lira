// src/shared/fattura-pdf.ts
//
// View-model puro per il PDF della fattura (Slice 5D). Mappa i dati della
// fattura + il cedente risolto in una struttura pronta per il disegno pdfkit,
// senza alcuna dipendenza da pdfkit/DOM/DB. Tutta la logica di correttezza
// fiscale (dicitura sempre presente, watermark bozza, importi NC positivi,
// placeholder sui dati mancanti) vive qui, testabile in isolamento.

import type { Cedente } from './cedente';
import type { ClienteSnapshotXml } from './fattura-xml';
import { computeRigaTotale, SOGLIA_BOLLO, DICITURA_FORFETTARIO, validateClienteSnapshot } from './fattura-logic';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface FatturaPdfInput {
  cedente: Cedente;
  cliente: ClienteSnapshotXml;
  numero: string | null;
  data: string;
  righe: Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>;
  importo: number;
  marcaDaBollo: boolean;
  bolloAddebitato: boolean;
  tipoDocumento: 'TD01' | 'TD04';
  fatturaOriginale?: { numero: string; data: string };
  stato: string;
  note: string | null;
  modalitaPagamento: string | null;
}

export interface RigaPdfView {
  descrizione: string;
  quantita: number;
  prezzoUnitario: number;
  prezzoTotale: number;
}

export interface PartyPdfView {
  nome: string;
  partitaIva: string | null;
  codiceFiscale: string | null;
  indirizzo: string;
  cap: string;
  citta: string;
  provincia: string;
}

const PLACEHOLDER = '(dato mancante)';

/** Campo richiesto: placeholder se vuoto (best-effort sulle bozze). */
function field(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s || PLACEHOLDER;
}

/** Identificativo opzionale: valore o null (niente placeholder). */
function optId(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}

export interface FatturaPdfModel {
  watermark: boolean;
  titolo: string;
  riferimentoOriginale: { numero: string; data: string } | null;
  numero: string | null;
  data: string;
  cedente: PartyPdfView;
  cessionario: PartyPdfView;
  righe: RigaPdfView[];
  totali: { imponibile: number; bollo: number; totale: number };
  dicitura: string;
  note: string | null;
}

/**
 * Validazione PDF split per stato (decisione 5D):
 * - bozza → best-effort, nessun errore (il PDF si renderizza con i placeholder);
 * - documento emesso (numerato) → fail-fast come l'XML: un PDF fiscalmente
 *   valido con intestazione rotta è peggio di un errore.
 * Il cedente è già risolto fail-fast a monte (readCedenteFromProfile).
 */
export function validateFatturaForPdf(input: FatturaPdfInput): string[] {
  if (input.stato === 'bozza') return [];
  const errors: string[] = [];
  if (input.cedente.regime !== 'forfettario') {
    errors.push('Export PDF supportato solo per il regime forfettario: il regime ordinario non è ancora implementato.');
  }
  if (!(Number(input.importo) > 0)) errors.push('Importo totale della fattura pari a zero.');
  const c = input.cliente;
  if (!c || !String(c.nome ?? '').trim()) {
    errors.push('Cliente senza denominazione.');
  } else {
    if (!String(c.indirizzo ?? '').trim()) errors.push('Indirizzo del cliente mancante.');
    if (!String(c.cap ?? '').trim()) errors.push('CAP del cliente mancante.');
    if (!String(c.citta ?? '').trim()) errors.push('Comune del cliente mancante.');
    const cliErr = validateClienteSnapshot({
      nazione: c.nazione, partitaIva: c.partitaIva, codiceFiscale: c.codiceFiscale,
    });
    if (cliErr) errors.push(cliErr);
  }
  return errors;
}

export function buildFatturaPdfModel(input: FatturaPdfInput): FatturaPdfModel {
  const isNC = input.tipoDocumento === 'TD04';

  const righe: RigaPdfView[] = input.righe.map((r) => ({
    descrizione: r.descrizione,
    quantita: Number(r.quantita) || 0,
    prezzoUnitario: round2(Number(r.prezzoUnitario) || 0),
    prezzoTotale: computeRigaTotale(r),
  }));

  const ced = input.cedente;
  const cli = input.cliente;
  const cedente: PartyPdfView = {
    nome: field([ced.nome, ced.cognome].filter(Boolean).join(' ')),
    partitaIva: optId(ced.partitaIva),
    codiceFiscale: optId(ced.codiceFiscale),
    indirizzo: field(ced.indirizzo),
    cap: field(ced.cap),
    citta: field(ced.comune),
    provincia: field(ced.provincia),
  };
  const cessionario: PartyPdfView = {
    nome: field(cli.nome),
    partitaIva: optId(cli.partitaIva),
    codiceFiscale: optId(cli.codiceFiscale),
    indirizzo: field(cli.indirizzo),
    cap: field(cli.cap),
    citta: field(cli.citta),
    provincia: field(cli.provincia),
  };

  const imponibile = round2(input.importo);
  // Rimborso bollo addebitato al cliente: solo TD01, marca + addebito, sopra
  // soglia — speculare a ImportoTotaleDocumento dell'XML (fattura-xml.ts).
  const bollo = (!isNC && input.marcaDaBollo && input.bolloAddebitato && imponibile > SOGLIA_BOLLO)
    ? 2 : 0;

  return {
    watermark: input.stato === 'bozza',
    titolo: isNC ? 'Nota di Credito' : 'Fattura',
    riferimentoOriginale: isNC && input.fatturaOriginale ? input.fatturaOriginale : null,
    numero: input.numero ?? null,
    data: input.data,
    cedente,
    cessionario,
    righe,
    totali: { imponibile, bollo, totale: round2(imponibile + bollo) },
    // Dicitura sempre presente per il forfettario (obbligatoria); la nota
    // dell'utente è additiva, mai sostitutiva (fix del difetto CalcoliVari).
    dicitura: input.cedente.regime === 'forfettario' ? DICITURA_FORFETTARIO : '',
    note: input.note && input.note.trim() ? input.note.trim() : null,
  };
}
