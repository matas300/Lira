import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsWithFatture, computeNettoMensile, computeAllocation } from './budget-calc';

test('monthsWithFatture: somma per mese, NC (TD04) negative, esclude bozze', () => {
  const fatture = [
    { importo: 1000, ritenuta: 0, pagAnno: 2026, pagMese: 3, stato: 'pagata', tipoDocumento: 'TD01' },
    { importo: 200, ritenuta: 0, pagAnno: 2026, pagMese: 3, stato: 'pagata', tipoDocumento: 'TD04' }, // NC -200
    { importo: 500, ritenuta: 0, pagAnno: 2026, pagMese: 5, stato: 'pagata', tipoDocumento: 'TD01' },
    { importo: 999, ritenuta: 0, pagAnno: 2026, pagMese: 7, stato: 'bozza', tipoDocumento: 'TD01' }, // esclusa
    { importo: 300, ritenuta: 0, pagAnno: 2025, pagMese: 4, stato: 'pagata', tipoDocumento: 'TD01' }, // altro anno
  ];
  const r = monthsWithFatture(fatture, 2026);
  assert.deepEqual(r, [{ month: 3, lordo: 800 }, { month: 5, lordo: 500 }]);
});

test('monthsWithFatture: scala la ritenuta dal lordo', () => {
  const r = monthsWithFatture(
    [{ importo: 1000, ritenuta: 200, pagAnno: 2026, pagMese: 2, stato: 'pagata', tipoDocumento: 'TD01' }],
    2026,
  );
  assert.deepEqual(r, [{ month: 2, lordo: 800 }]);
});

test('monthsWithFatture: esclude mesi con totale <= 0', () => {
  const r = monthsWithFatture(
    [
      { importo: 100, ritenuta: 0, pagAnno: 2026, pagMese: 6, stato: 'pagata', tipoDocumento: 'TD01' },
      { importo: 100, ritenuta: 0, pagAnno: 2026, pagMese: 6, stato: 'pagata', tipoDocumento: 'TD04' },
    ],
    2026,
  );
  assert.deepEqual(r, []);
});

test('computeNettoMensile: manuale usa il mese scelto', () => {
  const months = [{ month: 3, lordo: 1000 }, { month: 5, lordo: 2000 }];
  const r = computeNettoMensile({ baseMonth: 3, months, rate: 0.3, nettoAnnuo: 99999 });
  assert.equal(r.source, 'manual');
  assert.equal(r.month, 3);
  assert.equal(r.lordo, 1000);
  assert.equal(r.netto, 700);
});

test('computeNettoMensile: auto usa l ultimo mese disponibile', () => {
  const months = [{ month: 3, lordo: 1000 }, { month: 5, lordo: 2000 }];
  const r = computeNettoMensile({ baseMonth: null, months, rate: 0.25, nettoAnnuo: 99999 });
  assert.equal(r.source, 'auto');
  assert.equal(r.month, 5);
  assert.equal(r.netto, 1500);
});

test('computeNettoMensile: mese manuale inesistente → fallback auto', () => {
  const months = [{ month: 3, lordo: 1000 }];
  const r = computeNettoMensile({ baseMonth: 9, months, rate: 0, nettoAnnuo: 0 });
  assert.equal(r.source, 'auto');
  assert.equal(r.month, 3);
});

test('computeNettoMensile: nessuna fattura → media annuale', () => {
  const r = computeNettoMensile({ baseMonth: null, months: [], rate: 0.3, nettoAnnuo: 12000 });
  assert.equal(r.source, 'media');
  assert.equal(r.month, null);
  assert.equal(r.netto, 1000);
});

test('computeAllocation: split auto sul rimanente in parti uguali', () => {
  const items = [
    { nome: 'Affitto', importo: 400, auto: false, ordine: 0 },
    { nome: 'Risparmio', importo: 0, auto: true, ordine: 1 },
    { nome: 'Extra', importo: 0, auto: true, ordine: 2 },
  ];
  const a = computeAllocation(items, 1000);
  assert.equal(a.rows[1]!.val, 300);
  assert.equal(a.rows[1]!.isAuto, true);
  assert.equal(a.rows[2]!.val, 300);
  assert.equal(a.totBudget, 1000);
  assert.equal(a.rimanente, 0);
});

test('computeAllocation: voce auto con importo manuale > 0 non è auto', () => {
  const items = [{ nome: 'X', importo: 250, auto: true, ordine: 0 }];
  const a = computeAllocation(items, 1000);
  assert.equal(a.rows[0]!.isAuto, false);
  assert.equal(a.rows[0]!.val, 250);
  assert.equal(a.rimanente, 750);
});

test('computeAllocation: rimanente negativo quando le voci superano il netto', () => {
  const items = [{ nome: 'X', importo: 1200, auto: false, ordine: 0 }];
  const a = computeAllocation(items, 1000);
  assert.equal(a.rimanente, -200);
});

test('computeAllocation: pct calcolata sul netto', () => {
  const items = [{ nome: 'X', importo: 250, auto: false, ordine: 0 }];
  const a = computeAllocation(items, 1000);
  assert.equal(a.rows[0]!.pct, 25);
});
