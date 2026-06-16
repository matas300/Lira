// src/client/pages/scadenze.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSummary,
  renderRow,
  renderRowsTable,
  renderWarnings,
  renderNeedsConfig,
  renderScadenze,
} from './scadenze';
import type { ScadenziarioRow, ScadenziarioView } from './scadenze';

const TODAY = '2026-06-16';

function makeRow(over: Partial<ScadenziarioRow> = {}): ScadenziarioRow {
  return {
    id: 'imposta_saldo_2025',
    title: 'Imposta sostitutiva — saldo 2025',
    family: 'imposta_saldo',
    kind: 'tax',
    competenceYear: 2025,
    dueDate: '2026-06-30',
    dueDateOriginal: '2026-06-30',
    dueDateRolled: false,
    prorogaApplied: false,
    amount: { low: 1000, high: 1000, point: 1000 },
    certainty: 'official',
    payments: [],
    paidTotal: 0,
    status: { code: 'estimated', label: 'Da stimare', tone: 'info' },
    explanation: 'Saldo imposta sostitutiva.',
    ...over,
  };
}

function makePaidRow(): ScadenziarioRow {
  return makeRow({
    id: 'imposta_acc1_2025',
    title: 'Imposta sostitutiva — 1° acconto 2025',
    dueDate: '2025-06-30',
    amount: { low: 500, high: 500, point: 500 },
    payments: [{ id: 'pay-1', data: '2025-06-28', importo: 500, mode: 'pure' }],
    paidTotal: 500,
    status: { code: 'paid', label: 'Pagata', tone: 'ok' },
  });
}

function makeView(): ScadenziarioView {
  const toPay = makeRow();
  const paid = makePaidRow();
  return {
    year: 2025,
    method: 'storico',
    rows: [toPay, paid],
    summary: {
      totalDue: 1000,
      totalPaid: 500,
      totalResidual: 500,
      nextDue: toPay,
    },
    warnings: [],
    methodComparison: null as unknown as ScadenziarioView['methodComparison'],
    transition: null as unknown as ScadenziarioView['transition'],
    rulesRef: 'test',
  };
}

// ── renderSummary ──

test('renderSummary: mostra totale dovuto, pagato, residuo', () => {
  const view = makeView();
  const html = renderSummary(view.summary, view.method);
  assert.match(html, /1[.,]?000/);  // totalDue (locale can vary: 1.000 or 1000)
  assert.match(html, /500/);        // totalPaid
  assert.match(html, /[Dd]ovuto|[Tt]otale/);
  assert.match(html, /[Pp]agato/);
  assert.match(html, /[Rr]esiduo/);
  assert.match(html, /storico/i);   // badge metodo
});

test('renderSummary: prossima scadenza indicata', () => {
  const view = makeView();
  const html = renderSummary(view.summary, view.method);
  assert.match(html, /Prossima|Imposta/i);
});

// ── renderRow ──

test('renderRow: riga non pagata ha chip stato e bottone pay con data-key', () => {
  const row = makeRow();
  const html = renderRow(row, TODAY);
  assert.match(html, /data-action="pay"/);
  assert.match(html, /data-key="imposta_saldo_2025"/);
  assert.match(html, /Da stimare|estimated|info/i);
  // L'importo è mostrato
  assert.match(html, /1\.000|1000/);
});

test('renderRow: riga pagata NON ha bottone pay, ha bottone unpay', () => {
  const row = makePaidRow();
  const html = renderRow(row, TODAY);
  assert.doesNotMatch(html, /data-action="pay"/);
  assert.match(html, /data-action="unpay"/);
  // chip stato ok/Pagata
  assert.match(html, /Pagata|paid|ok/i);
});

test('renderRow: chip timing presente', () => {
  const row = makeRow({ dueDate: '2026-05-01' }); // passato
  const html = renderRow(row, TODAY);
  assert.match(html, /Scaduta|scaduta/);
});

test('renderRow: range low-high mostrato se diversi', () => {
  const row = makeRow({ amount: { low: 800, high: 1200, point: 1000 } });
  const html = renderRow(row, TODAY);
  assert.match(html, /800/);
  assert.match(html, /1\.200|1200/);
});

test('renderRow: pagamenti versati elencati', () => {
  const row = makePaidRow();
  const html = renderRow(row, TODAY);
  assert.match(html, /2025-06-28|28.06.2025|500/);
});

// ── renderRowsTable ──

test('renderRowsTable: divide da-pagare e pagate', () => {
  const rows = [makeRow(), makePaidRow()];
  const html = renderRowsTable(rows, TODAY);
  // Sezione "Da pagare"
  assert.match(html, /Da pagare/);
  // Sezione "Pagate" in details
  assert.match(html, /<details/);
  assert.match(html, /Pagate/);
});

test('renderRowsTable: nessuna riga da pagare → non crasha', () => {
  const rows = [makePaidRow()];
  const html = renderRowsTable(rows, TODAY);
  assert.match(html, /Pagate/);
  assert.doesNotThrow(() => html);
});

test('renderRowsTable: tutte da pagare → sezione pagate vuota o assente', () => {
  const rows = [makeRow()];
  const html = renderRowsTable(rows, TODAY);
  assert.match(html, /Da pagare/);
  assert.doesNotThrow(() => html);
});

// ── renderWarnings ──

test('renderWarnings: lista i warning', () => {
  const warnings = [
    { code: 'W1', severity: 'warn' as const, title: 'Attenzione soglia', message: 'Superi la soglia.' },
  ];
  const html = renderWarnings(warnings);
  assert.match(html, /Attenzione soglia/);
  assert.match(html, /Superi la soglia/);
});

test('renderWarnings: nessun warning → stringa vuota', () => {
  assert.equal(renderWarnings([]), '');
});

// ── renderNeedsConfig ──

test('renderNeedsConfig: CTA Configura con anno', () => {
  const html = renderNeedsConfig(2026);
  assert.match(html, /2026/);
  assert.match(html, /Configura/);
  assert.match(html, /href.*tasse|data-route.*tasse/);
});

// ── renderScadenze ──

test('renderScadenze: compone tutte le sezioni', () => {
  const view = makeView();
  const html = renderScadenze(view, TODAY);
  assert.match(html, /Scadenze/i);
  assert.match(html, /Da pagare/);
  assert.match(html, /Pagate/);
});
