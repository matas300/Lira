import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prossimeScadenze,
  renderSintesiCard, renderLimitCard, renderScadenzeCard,
  renderDichiarazioneCta, renderConfigPrompt,
} from './riepilogo';
import type { ScadenziarioRow } from './scadenze';
import type { ForfettarioScenario } from '@server/lib/tax-engine';

function fakeSelected(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  // Solo i campi usati dalla card sintesi; il resto castato per il test.
  return { substituteTax: 1500, deductibleContributionsPaid: 4000, ...over } as ForfettarioScenario;
}

function row(id: string, dueDate: string, point: number, paidTotal: number): ScadenziarioRow {
  return {
    id, title: `Scadenza ${id}`, family: 'f', kind: 'tax', competenceYear: 2026,
    dueDate, dueDateOriginal: dueDate, dueDateRolled: false, prorogaApplied: false,
    amount: { low: point, high: point, point }, certainty: 'official',
    payments: [], paidTotal,
    status: { code: 'underpaid', label: 'x', tone: 'warn' }, explanation: '',
  };
}

test('prossimeScadenze: tiene solo le righe con residuo > 0, ordina per data, taglia a N', () => {
  const rows: ScadenziarioRow[] = [
    row('a', '2026-11-30', 1000, 1000), // saldata → esclusa
    row('b', '2026-06-30', 1000, 200),  // residuo 800
    row('c', '2026-08-20', 500, 0),     // residuo 500
    row('d', '2026-05-16', 300, 0),     // residuo 300
    row('e', '2026-02-16', 100, 0),     // residuo 100
  ];
  const out = prossimeScadenze(rows, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id), ['e', 'd', 'b']); // ordinate per data crescente
});

test('prossimeScadenze: residuo ~0 (tolleranza) escluso', () => {
  const rows = [row('x', '2026-06-30', 1000, 999.999)];
  assert.equal(prossimeScadenze(rows, 4).length, 0);
});

test('prossimeScadenze: nessuna scadenza → array vuoto', () => {
  assert.deepEqual(prossimeScadenze([], 4), []);
});

test('renderSintesiCard: mostra lordo, imposta, INPS, netto e % effettiva + link a /', () => {
  const html = renderSintesiCard(fakeSelected(), 30000, 24500);
  assert.match(html, /Totale annuo lordo/);
  assert.match(html, /Netto annuo/);
  assert.match(html, /Netto mensile/);
  assert.match(html, /effettiva/i);
  assert.match(html, /data-route="\/"/); // "Dettaglio fiscale →"
});

test('renderLimitCard: sotto-soglia nessuna nota; barra con percentuale', () => {
  const html = renderLimitCard(40000, 85000);
  assert.match(html, /progress-fill/);
  assert.match(html, /47%/); // 40000/85000
  assert.doesNotMatch(html, /superata/i);
  assert.match(html, /data-route="\/fatture"/);
});

test('renderLimitCard: ≥100% mostra nota di superamento (rosso)', () => {
  const html = renderLimitCard(90000, 85000);
  assert.match(html, /superata/i);
});

test('renderScadenzeCard: lista righe con chip timing + residuo totale + link', () => {
  const rows: ScadenziarioRow[] = [row('b', '2026-06-30', 1000, 200)];
  const html = renderScadenzeCard(rows, 800, '2026-06-01');
  assert.match(html, /Scadenza b/);
  assert.match(html, /€800,00/);        // residuo della riga
  assert.match(html, /chip/);           // chip timing
  assert.match(html, /Residuo totale/);
  assert.match(html, /data-route="\/scadenze"/);
});

test('renderScadenzeCard: nessuna scadenza → stato vuoto', () => {
  const html = renderScadenzeCard([], 0, '2026-06-01');
  assert.match(html, /Nessuna scadenza/i);
});

test('renderDichiarazioneCta: link a /dichiarazione', () => {
  assert.match(renderDichiarazioneCta(), /data-route="\/dichiarazione"/);
});

test('renderConfigPrompt: punta a /impostazioni e cita l\'anno', () => {
  const html = renderConfigPrompt(2026);
  assert.match(html, /2026/);
  assert.match(html, /data-route="\/impostazioni"/);
});
