import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prossimeScadenze } from './riepilogo';
import type { ScadenziarioRow } from './scadenze';

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
