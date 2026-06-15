// src/server/lib/fattura-pdf-render.ts
//
// Adapter di disegno pdfkit per il PDF della fattura (Slice 5D). Deliberatamente
// SOTTILE: consuma il view-model puro (@shared/fattura-pdf) e disegna le quattro
// sezioni (intestazione+parti, tabella righe, riepilogo totali, footer legale)
// con un polish tipografico contenuto. Nessuna logica fiscale qui — vive tutta
// nel view-model, testabile in isolamento. compress:false così il testo resta
// ispezionabile nei byte (i documenti fattura sono piccoli).

import PDFDocument from 'pdfkit';
import type { FatturaPdfModel, PartyPdfView } from '@shared/fattura-pdf';

const INK = '#1a1a1a';
const MUTED = '#666666';
const RULE = '#cccccc';

function fmtMoney(n: number): string {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

function partyIdentifier(p: PartyPdfView): string {
  if (p.partitaIva) return `P.IVA ${p.partitaIva}`;
  if (p.codiceFiscale) return `C.F. ${p.codiceFiscale}`;
  return '';
}

function drawWatermark(doc: PDFKit.PDFDocument): void {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-45, { origin: [width / 2, height / 2] });
  doc.fontSize(48).fillColor(RULE).opacity(0.5)
    .text('BOZZA - NON VALIDA AI FINI FISCALI', 0, height / 2 - 24, { width, align: 'center' });
  doc.opacity(1).restore();
}

function drawParty(doc: PDFKit.PDFDocument, label: string, p: PartyPdfView, x: number, y: number, w: number): void {
  doc.fontSize(8).fillColor(MUTED).font('Helvetica-Bold').text(label, x, y, { width: w });
  doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(p.nome, x, doc.y + 2, { width: w });
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const id = partyIdentifier(p);
  if (id) doc.text(id, { width: w });
  doc.text(p.indirizzo, { width: w });
  doc.text(`${p.cap} ${p.citta} ${p.provincia}`.trim(), { width: w });
}

/** Disegna il PDF e risolve il Buffer completo. */
export function renderFatturaPdf(model: FatturaPdfModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentW = right - left;

    if (model.watermark) drawWatermark(doc);

    // ── 1. Intestazione + parti ──
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(model.titolo, left, 50);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(`Numero: ${model.numero ?? 'BOZZA'}`, left, doc.y + 2);
    doc.text(`Data: ${fmtDate(model.data)}`);
    if (model.riferimentoOriginale) {
      doc.text(`Riferimento: fattura ${model.riferimentoOriginale.numero} del ${fmtDate(model.riferimentoOriginale.data)}`);
    }

    const partyY = doc.y + 16;
    const colW = (contentW - 20) / 2;
    drawParty(doc, 'CEDENTE / PRESTATORE', model.cedente, left, partyY, colW);
    drawParty(doc, 'CESSIONARIO / COMMITTENTE', model.cessionario, left + colW + 20, partyY, colW);

    // ── 2. Tabella righe ──
    let y = Math.max(doc.y, partyY) + 24;
    const cols = { desc: left, qta: left + contentW - 200, pu: left + contentW - 130, tot: left + contentW - 60 };
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED);
    doc.text('Descrizione', cols.desc, y);
    doc.text('Q.tà', cols.qta, y, { width: 50, align: 'right' });
    doc.text('Prezzo', cols.pu, y, { width: 60, align: 'right' });
    doc.text('Totale', cols.tot, y, { width: 60, align: 'right' });
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
    y += 6;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    for (const r of model.righe) {
      const descH = doc.heightOfString(r.descrizione, { width: cols.qta - cols.desc - 10 });
      doc.text(r.descrizione, cols.desc, y, { width: cols.qta - cols.desc - 10 });
      doc.text(r.quantita.toLocaleString('it-IT'), cols.qta, y, { width: 50, align: 'right' });
      doc.text(fmtMoney(r.prezzoUnitario), cols.pu, y, { width: 60, align: 'right' });
      doc.text(fmtMoney(r.prezzoTotale), cols.tot, y, { width: 60, align: 'right' });
      y += Math.max(descH, 12) + 6;
    }

    // ── 3. Riepilogo totali ──
    doc.moveTo(left, y).lineTo(right, y).strokeColor(RULE).stroke();
    y += 8;
    const totLabelX = left + contentW - 200;
    const totValX = left + contentW - 90;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text('Imponibile', totLabelX, y, { width: 110, align: 'right' });
    doc.fillColor(INK).text(fmtMoney(model.totali.imponibile), totValX, y, { width: 90, align: 'right' });
    if (model.totali.bollo > 0) {
      y += 14;
      doc.fillColor(MUTED).text('Imposta di bollo', totLabelX, y, { width: 110, align: 'right' });
      doc.fillColor(INK).text(fmtMoney(model.totali.bollo), totValX, y, { width: 90, align: 'right' });
    }
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
    doc.text('TOTALE', totLabelX, y, { width: 110, align: 'right' });
    doc.text(fmtMoney(model.totali.totale), totValX, y, { width: 90, align: 'right' });

    // ── 4. Footer legale ──
    y += 36;
    if (model.dicitura) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(model.dicitura, left, y, { width: contentW });
    }
    if (model.note) {
      doc.moveDown(0.5).fontSize(8).fillColor(INK).text(model.note, { width: contentW });
    }

    doc.end();
  });
}
