// src/client/components/donut.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDonut } from './donut';

test('renderDonut: SVG con 3 segmenti e % netto al centro', () => {
  const html = renderDonut({ netto: 1900, imposta: 600, inps: 500 });
  assert.match(html, /<svg/);
  // tre archi (uno per netto/imposta/inps)
  assert.equal((html.match(/<circle/g) ?? []).length, 3);
  // % netto = 1900/3000 = 63%
  assert.match(html, /63%/);
  // colori dai token
  assert.match(html, /--color-primary/);
  assert.match(html, /--color-tertiary/);
  assert.match(html, /--color-secondary/);
});

test('renderDonut: include la legenda con i valori formattati', () => {
  const html = renderDonut({ netto: 1900, imposta: 600, inps: 500 });
  assert.match(html, /Netto/);
  assert.match(html, /Imposta/);
  assert.match(html, /INPS/);
});

test('renderDonut: total 0 non crasha e mostra "Nessun dato"', () => {
  const html = renderDonut({ netto: 0, imposta: 0, inps: 0 });
  assert.match(html, /Nessun dato/);
  assert.doesNotMatch(html, /NaN/);
});

test('renderDonut: valori negativi clampati a 0 (nessun NaN)', () => {
  const html = renderDonut({ netto: -100, imposta: 600, inps: 500 });
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /<svg/);
});
