// src/client/pages/tasse.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderStatus, renderTable, renderDeferred, renderNeedsConfig, renderTasse,
} from './tasse';
import type { AccRow, AccDeferred } from '../lib/accantonamento';
import type { AccResult } from '../lib/accantonamento';

// ── renderStatus ─────────────────────────────────────────────────────────────

test('renderStatus: gap > 0 → mostra tono warn + importi €', () => {
  const html = renderStatus({ lordo: 5000, daAccantonare: 1500, versato: 800, gap: 700 });
  // Deve indicare "Da versare" o simile, con un tono di avvertimento
  assert.match(html, /700|versare|warn|warning/i);
  // Deve mostrare il maturato e il versato
  assert.match(html, /1\.500|1500/);
  assert.match(html, /800/);
});

test('renderStatus: gap <= 0 → tono ok, messaggio "in pari" o positivo', () => {
  const html = renderStatus({ lordo: 5000, daAccantonare: 1000, versato: 1200, gap: -200 });
  assert.match(html, /in pari|pari|ok|positiv/i);
});

test('renderStatus: mostra lordo, daAccantonare, versato e gap come €', () => {
  const html = renderStatus({ lordo: 3000, daAccantonare: 900, versato: 600, gap: 300 });
  assert.match(html, /3\.000|3000/);
  assert.match(html, /900/);
  assert.match(html, /600/);
  assert.match(html, /300/);
});

// ── renderTable ───────────────────────────────────────────────────────────────

test('renderTable: mostra le righe fatture + footer totali', () => {
  const rows: AccRow[] = [
    { label: 'Mario Rossi', mese: 3, lordo: 2000, daAccantonare: 600 },
    { label: 'Acme Srl', mese: 7, lordo: 1500, daAccantonare: 450 },
  ];
  const html = renderTable(rows, { lordo: 3500, daAccantonare: 1050, versato: 800, gap: 250 });
  assert.match(html, /Mario Rossi/);
  assert.match(html, /Acme Srl/);
  // footer totali
  assert.match(html, /3\.500|3500/);
  assert.match(html, /1\.050|1050/);
});

test('renderTable: righe vuote → messaggio nessuna fattura', () => {
  const html = renderTable([], { lordo: 0, daAccantonare: 0, versato: 0, gap: 0 });
  assert.match(html, /[Nn]essun|vuoto/i);
});

test('renderTable: escape del nome cliente (no injection)', () => {
  const rows: AccRow[] = [
    { label: '<script>alert(1)</script>', mese: 1, lordo: 1000, daAccantonare: 300 },
  ];
  const html = renderTable(rows, { lordo: 1000, daAccantonare: 300, versato: 0, gap: 300 });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ── renderDeferred ────────────────────────────────────────────────────────────

test('renderDeferred: vuoto → nota "nessuna fattura differita"', () => {
  const html = renderDeferred([]);
  assert.match(html, /[Nn]essun|differit/i);
});

test('renderDeferred: mostra le fatture differite con importo e anno incasso', () => {
  const deferred: AccDeferred[] = [
    { label: 'Cliente A', importo: 1200, annoIncasso: 2026 },
    { label: 'Cliente B', importo: 800, annoIncasso: null },
  ];
  const html = renderDeferred(deferred);
  assert.match(html, /Cliente A/);
  assert.match(html, /Cliente B/);
  assert.match(html, /2026/);
  assert.match(html, /1\.200|1200/);
});

// ── renderNeedsConfig ─────────────────────────────────────────────────────────

test('renderNeedsConfig: mostra anno e CTA configura', () => {
  const html = renderNeedsConfig(2025);
  assert.match(html, /2025/);
  assert.match(html, /[Cc]onfigura/);
});

// ── renderTasse ───────────────────────────────────────────────────────────────

test('renderTasse: compone status + grafico + tabella + differite', () => {
  const result: AccResult = {
    rows: [{ label: 'Cliente X', mese: 4, lordo: 2000, daAccantonare: 600 }],
    totals: { lordo: 2000, daAccantonare: 600, versato: 400, gap: 200 },
    cumulative: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, maturato: 600, versato: 400 })),
    deferred: [],
  };
  const chartSvg = '<svg data-test="chart"></svg>';
  const html = renderTasse(result, chartSvg);
  // Grafico incluso
  assert.match(html, /data-test="chart"/);
  // Status incluso
  assert.match(html, /200/); // gap
  // Tabella inclusa
  assert.match(html, /Cliente X/);
});
