import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFrontespizio, renderQuadro, renderWarnings, renderConfigPrompt } from './dichiarazione';
import type { Dichiarazione } from '@server/lib/dichiarazione-engine';

const dich: Dichiarazione = {
  frontespizio: { codiceFiscale: 'RSSMRA80A01H501U', cognome: 'Rossi', nome: 'Mario', dataNascita: '1980-01-01', comune: 'Roma', provincia: 'RM', annoImposta: 2025, regime: 'RF19', tipoDichiarazione: 'ordinaria' },
  quadroLM: [{ key: 'LM1', label: 'Ricavi', value: 30000, source: 'computed' }, { key: 'LM45', label: 'Saldo', value: 1415, source: 'computed' }],
  quadroRR: { sezione: 'artigiani_commercianti', righi: [{ key: 'RR_TOTALE', label: 'Totale', value: 5200, source: 'computed' }] },
  quadroRX: [{ key: 'RX1', label: 'Credito', value: 0, source: 'zero' }],
  quadroRS: [],
  warnings: [{ code: 'RS_INFORMATIVO', severity: 'info', message: 'RS informativo' }],
};

test('renderFrontespizio: contribuente, anno, regime + nota anno imposta', () => {
  const html = renderFrontespizio(dich.frontespizio);
  assert.match(html, /RSSMRA80A01H501U/);
  assert.match(html, /Rossi/);
  assert.match(html, /2025/);
  assert.match(html, /RF19/);
  assert.match(html, /2026/); // nota: presentata nel 2026
});

test('renderQuadro: titolo + righi label/valore', () => {
  const html = renderQuadro('Quadro LM', dich.quadroLM);
  assert.match(html, /Quadro LM/);
  assert.match(html, /Ricavi/);
  assert.match(html, /€30\.000,00/);
});

test('renderQuadro: stato vuoto se nessun rigo', () => {
  assert.match(renderQuadro('Quadro RS', []), /Nessun dato/i);
});

test('renderWarnings: error rosso, info neutro; vuoto se nessuno', () => {
  const html = renderWarnings([
    { code: 'X', severity: 'error', message: 'Errore grave' },
    { code: 'RS_INFORMATIVO', severity: 'info', message: 'info' },
  ]);
  assert.match(html, /Errore grave/);
  assert.match(html, /dich-warn-error/);
  assert.equal(renderWarnings([]), '');
});

test('renderConfigPrompt: punta a /impostazioni', () => {
  assert.match(renderConfigPrompt(2025), /data-route="\/impostazioni"/);
});
