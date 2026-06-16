// src/client/components/cumulative-chart.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCumulativeChart } from './cumulative-chart';

test('renderCumulativeChart: SVG con due polilinee per 3 punti', () => {
  const points = [
    { month: 1, maturato: 300, versato: 200 },
    { month: 6, maturato: 600, versato: 400 },
    { month: 12, maturato: 900, versato: 750 },
  ];
  const html = renderCumulativeChart(points);
  assert.match(html, /<svg/);
  // Due polilinee o path per maturato e versato
  const polylineCount = (html.match(/<polyline/g) ?? []).length;
  const pathCount = (html.match(/<path/g) ?? []).length;
  assert.ok(polylineCount >= 2 || pathCount >= 2, 'Deve avere almeno 2 polilinee o path');
});

test('renderCumulativeChart: usa --color-tertiary per maturato e --color-primary per versato', () => {
  const points = [
    { month: 1, maturato: 300, versato: 200 },
    { month: 6, maturato: 600, versato: 400 },
  ];
  const html = renderCumulativeChart(points);
  assert.match(html, /--color-tertiary/);
  assert.match(html, /--color-primary/);
});

test('renderCumulativeChart: include legenda con "Maturato" e "Versato"', () => {
  const points = [
    { month: 3, maturato: 500, versato: 300 },
  ];
  const html = renderCumulativeChart(points);
  assert.match(html, /[Mm]aturato/);
  assert.match(html, /[Vv]ersato/);
});

test('renderCumulativeChart: include etichette mesi asse X', () => {
  const points = [
    { month: 1, maturato: 100, versato: 50 },
    { month: 6, maturato: 600, versato: 400 },
    { month: 12, maturato: 900, versato: 800 },
  ];
  const html = renderCumulativeChart(points);
  // Deve includere almeno alcune etichette mese (Gen / Dic o 1 / 12)
  const hasMonthLabels = /Gen|Dic|Jan|Dec|<text/.test(html);
  assert.ok(hasMonthLabels, 'Deve avere etichette mesi');
});

test('renderCumulativeChart: 0 punti → "Nessun dato"', () => {
  const html = renderCumulativeChart([]);
  assert.match(html, /[Nn]essun dato/);
  assert.doesNotMatch(html, /<svg/);
});

test('renderCumulativeChart: max=0 → nessun NaN nell\'output', () => {
  const points = [
    { month: 1, maturato: 0, versato: 0 },
    { month: 6, maturato: 0, versato: 0 },
  ];
  const html = renderCumulativeChart(points);
  assert.doesNotMatch(html, /NaN/);
  assert.match(html, /<svg/);
});

test('renderCumulativeChart: valori numerici finiti nelle coordinate', () => {
  const points = [
    { month: 1, maturato: 1000, versato: 500 },
    { month: 12, maturato: 5000, versato: 3000 },
  ];
  const html = renderCumulativeChart(points);
  // Non deve contenere Infinity o NaN
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /Infinity/);
});
