// src/shared/fattura-pdf.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFatturaPdfModel, validateFatturaForPdf, type FatturaPdfInput } from './fattura-pdf';
import type { Cedente } from './cedente';

const cedente: Cedente = {
  partitaIva: '12345678903', codiceFiscale: 'RSSMRA80A01H501U',
  nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via Roma 1', cap: '00100',
  comune: 'Roma', provincia: 'RM', nazione: 'IT', regime: 'forfettario',
};

function baseInput(over: Partial<FatturaPdfInput> = {}): FatturaPdfInput {
  return {
    cedente,
    cliente: {
      nome: 'ACME Srl', partitaIva: '12345678903', nazione: 'IT',
      indirizzo: 'Via Milano 2', cap: '20100', citta: 'Milano', provincia: 'MI',
    },
    numero: '2025/3', data: '2025-06-01',
    righe: [{ descrizione: 'Consulenza', quantita: 1, prezzoUnitario: 1000 }],
    importo: 1000, marcaDaBollo: false, bolloAddebitato: false,
    tipoDocumento: 'TD01', stato: 'inviata', note: null, modalitaPagamento: 'bonifico',
    ...over,
  };
}

test('bozza → watermark attivo', () => {
  const m = buildFatturaPdfModel(baseInput({ stato: 'bozza', numero: null }));
  assert.equal(m.watermark, true);
});

test('documento emesso → niente watermark', () => {
  const m = buildFatturaPdfModel(baseInput({ stato: 'inviata' }));
  assert.equal(m.watermark, false);
});

test('TD01 → titolo Fattura, nessun riferimento', () => {
  const m = buildFatturaPdfModel(baseInput({ tipoDocumento: 'TD01' }));
  assert.equal(m.titolo, 'Fattura');
  assert.equal(m.riferimentoOriginale, null);
});

test('TD04 → titolo Nota di Credito + riferimento alla fattura originale', () => {
  const m = buildFatturaPdfModel(baseInput({
    tipoDocumento: 'TD04', fatturaOriginale: { numero: '2025/1', data: '2025-05-01' },
  }));
  assert.equal(m.titolo, 'Nota di Credito');
  assert.deepEqual(m.riferimentoOriginale, { numero: '2025/1', data: '2025-05-01' });
});

test('righe → prezzoTotale per riga e imponibile/totale', () => {
  const m = buildFatturaPdfModel(baseInput({
    righe: [
      { descrizione: 'A', quantita: 2, prezzoUnitario: 100 },
      { descrizione: 'B', quantita: 1, prezzoUnitario: 50 },
    ],
    importo: 250,
  }));
  assert.equal(m.righe.length, 2);
  assert.equal(m.righe[0]!.prezzoTotale, 200);
  assert.equal(m.righe[1]!.prezzoTotale, 50);
  assert.equal(m.totali.imponibile, 250);
  assert.equal(m.totali.bollo, 0);
  assert.equal(m.totali.totale, 250);
});

test('bollo addebitato sopra soglia (TD01) → +2€ nel totale', () => {
  const m = buildFatturaPdfModel(baseInput({
    importo: 1000, marcaDaBollo: true, bolloAddebitato: true,
  }));
  assert.equal(m.totali.bollo, 2);
  assert.equal(m.totali.totale, 1002);
});

test('bollo non addebitato → totale = imponibile anche sopra soglia', () => {
  const m = buildFatturaPdfModel(baseInput({
    importo: 1000, marcaDaBollo: true, bolloAddebitato: false,
  }));
  assert.equal(m.totali.bollo, 0);
  assert.equal(m.totali.totale, 1000);
});

test('forfettario → dicitura legale sempre presente', () => {
  const m = buildFatturaPdfModel(baseInput({ note: null }));
  assert.match(m.dicitura, /forfettario/i);
  assert.match(m.dicitura, /L\.?\s?190\/2014/);
  assert.equal(m.note, null);
});

test('nota utente è additiva, non sostituisce la dicitura', () => {
  const m = buildFatturaPdfModel(baseInput({ note: 'Grazie per la collaborazione' }));
  assert.match(m.dicitura, /forfettario/i);
  assert.equal(m.note, 'Grazie per la collaborazione');
});

test('parti → cedente (nome+cognome) e cessionario formattati', () => {
  const m = buildFatturaPdfModel(baseInput());
  assert.equal(m.cedente.nome, 'Mario Rossi');
  assert.equal(m.cedente.partitaIva, '12345678903');
  assert.equal(m.cedente.indirizzo, 'Via Roma 1');
  assert.equal(m.cessionario.nome, 'ACME Srl');
  assert.equal(m.cessionario.indirizzo, 'Via Milano 2');
  assert.equal(m.cessionario.citta, 'Milano');
});

test('documento emesso → numero presente', () => {
  const m = buildFatturaPdfModel(baseInput({ numero: '2025/3' }));
  assert.equal(m.numero, '2025/3');
});

test('bozza → numero null', () => {
  const m = buildFatturaPdfModel(baseInput({ stato: 'bozza', numero: null }));
  assert.equal(m.numero, null);
});

test('bozza con cessionario incompleto → placeholder (dato mancante) sugli indirizzi', () => {
  const m = buildFatturaPdfModel(baseInput({
    stato: 'bozza', numero: null,
    cliente: { nome: 'Cliente X', nazione: 'IT' },
  }));
  assert.equal(m.cessionario.nome, 'Cliente X');
  assert.equal(m.cessionario.indirizzo, '(dato mancante)');
  assert.equal(m.cessionario.cap, '(dato mancante)');
  assert.equal(m.cessionario.citta, '(dato mancante)');
});

test('validazione: documento emesso valido → nessun errore', () => {
  assert.deepEqual(validateFatturaForPdf(baseInput({ stato: 'inviata' })), []);
});

test('validazione: emesso + cliente IT senza identificativo → fail-fast', () => {
  const errs = validateFatturaForPdf(baseInput({
    stato: 'inviata',
    cliente: { nome: 'X', nazione: 'IT', indirizzo: 'Via', cap: '20100', citta: 'Milano', provincia: 'MI' },
  }));
  assert.ok(errs.length > 0);
});

test('validazione: bozza incompleta → best-effort, nessun errore', () => {
  const errs = validateFatturaForPdf(baseInput({
    stato: 'bozza', numero: null,
    cliente: { nome: 'X', nazione: 'IT' },
  }));
  assert.deepEqual(errs, []);
});

test('validazione: regime ordinario su emesso → errore (non supportato)', () => {
  const errs = validateFatturaForPdf(baseInput({
    stato: 'inviata', cedente: { ...cedente, regime: 'ordinario' },
  }));
  assert.ok(errs.some((e) => /ordinario/i.test(e)));
});
