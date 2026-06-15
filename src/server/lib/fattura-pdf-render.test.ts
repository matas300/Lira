// src/server/lib/fattura-pdf-render.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFatturaPdfModel, type FatturaPdfInput } from '@shared/fattura-pdf';
import type { Cedente } from '@shared/cedente';
import { renderFatturaPdf } from './fattura-pdf-render';

const cedente: Cedente = {
  partitaIva: '12345678903', codiceFiscale: 'RSSMRA80A01H501U',
  nome: 'Mario', cognome: 'Rossi', indirizzo: 'Via Roma 1', cap: '00100',
  comune: 'Roma', provincia: 'RM', nazione: 'IT', regime: 'forfettario',
};

function input(over: Partial<FatturaPdfInput> = {}): FatturaPdfInput {
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

test('render → Buffer PDF valido (%PDF- ... %%EOF)', async () => {
  const buf = await renderFatturaPdf(buildFatturaPdfModel(input()));
  assert.ok(buf.length > 0);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.toString('latin1').includes('%%EOF'));
});
