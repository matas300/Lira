import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBaseSelector, renderVoceRow, renderTotali, renderNeedsConfig } from './budget';
import type { AllocRow } from '../lib/budget-calc';

test('renderBaseSelector: opzione Auto + mesi disponibili, selezione corrente', () => {
  const html = renderBaseSelector({
    baseMonth: 3,
    months: [{ month: 3, lordo: 1000 }, { month: 5, lordo: 2000 }],
    netto: { netto: 700, lordo: 1000, rate: 0.3, month: 3, source: 'manual' },
  });
  assert.match(html, /Auto \(ultima\)/);
  assert.match(html, /value="3"[^>]*selected/);
  assert.match(html, /Mag/); // mese 5 presente
});

test('renderVoceRow: input auto checked quando isAuto', () => {
  const alloc: AllocRow = { nome: 'Risparmio', val: 300, isAuto: true, pct: 30 };
  const html = renderVoceRow(1, { nome: 'Risparmio', importo: 0, auto: true, ordine: 1 }, alloc, 1000);
  assert.match(html, /data-idx="1"/);
  assert.match(html, /checkbox[^>]*checked/);
});

test('renderTotali: rimanente negativo marcato negative', () => {
  const html = renderTotali(1200, -200);
  assert.match(html, /is-negative/);
});

test('renderNeedsConfig: CTA verso configurazione anno', () => {
  const html = renderNeedsConfig(2026);
  assert.match(html, /2026/);
  assert.match(html, /data-route="\/"/);
});
