// src/client/lib/accantonamento.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAccantonamento } from './accantonamento';
import type { AccFattura, AccPagamento } from './accantonamento';

// Helpers
function f(over: Partial<AccFattura>): AccFattura {
  return {
    importo: 1000,
    data: '2025-01-15',
    pagAnno: 2025,
    pagMese: 1,
    ...over,
  };
}

function p(over: Partial<AccPagamento>): AccPagamento {
  return { data: '2025-01-20', importo: 200, ...over };
}

test('computeAccantonamento: rows filtrate per pagAnno === year', () => {
  const fatture: AccFattura[] = [
    f({ importo: 2000, ritenuta: 200, pagAnno: 2025, pagMese: 3, data: '2025-03-10' }), // incassata in 2025
    f({ importo: 1500, pagAnno: 2024, pagMese: 11, data: '2024-11-05' }),                // anno diverso, esclusa
    f({ importo: 1000, pagAnno: null, data: '2025-05-01' }),                              // non ancora incassata, esclusa da rows
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.mese, 3);
});

test('computeAccantonamento: imponibile = importo - ritenuta, daAccantonare = imponibile * rate', () => {
  const fatture: AccFattura[] = [
    f({ importo: 2000, ritenuta: 200, pagAnno: 2025, pagMese: 3, data: '2025-03-10' }),
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0.30 });
  // imponibile = 2000 - 200 = 1800; daAccantonare = 1800 * 0.30 = 540.00
  assert.equal(result.rows[0]!.lordo, 1800);
  assert.equal(result.rows[0]!.daAccantonare, 540);
});

test('computeAccantonamento: totals.versato = somma pagamenti tasse/contributi/misto, gap = daAccantonare - versato', () => {
  const fatture: AccFattura[] = [
    f({ importo: 2000, ritenuta: 200, pagAnno: 2025, pagMese: 3, data: '2025-03-10' }),
    f({ importo: 1000, pagAnno: 2025, pagMese: 6, data: '2025-06-01' }),
  ];
  const pagamenti: AccPagamento[] = [
    p({ data: '2025-03-15', importo: 300, tipo: 'tasse' }),
    p({ data: '2025-06-20', importo: 150, tipo: 'contributi' }),
  ];
  const result = computeAccantonamento({ fatture, pagamenti, year: 2025, effectiveRate: 0.30 });
  // lordo totale: 1800 + 1000 = 2800; daAccantonare = 2800 * 0.30 = 840
  assert.equal(result.totals.lordo, 2800);
  assert.equal(result.totals.daAccantonare, 840);
  assert.equal(result.totals.versato, 450);
  assert.equal(result.totals.gap, 390); // 840 - 450
});

test('computeAccantonamento: cumulative maturato è monotono crescente', () => {
  const fatture: AccFattura[] = [
    f({ importo: 1000, pagAnno: 2025, pagMese: 1, data: '2025-01-10' }),
    f({ importo: 2000, pagAnno: 2025, pagMese: 6, data: '2025-06-15' }),
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.cumulative.length, 12);
  // Valore a mese 1 < mese 6 (almeno non decresce)
  for (let i = 1; i < result.cumulative.length; i++) {
    assert.ok(result.cumulative[i]!.maturato >= result.cumulative[i - 1]!.maturato);
    assert.ok(result.cumulative[i]!.versato >= result.cumulative[i - 1]!.versato);
  }
  // mese 1 ha solo la prima fattura
  assert.equal(result.cumulative[0]!.month, 1);
  assert.equal(result.cumulative[0]!.maturato, 300); // 1000 * 0.30
  // mese 6 (idx 5) ha entrambe
  assert.equal(result.cumulative[5]!.maturato, 900); // (1000 + 2000) * 0.30
});

test('computeAccantonamento: deferred = emesse nell\'anno ma pagAnno !== year', () => {
  const fatture: AccFattura[] = [
    f({ importo: 1000, data: '2025-04-01', pagAnno: 2025, pagMese: 4 }), // incassata nell'anno → non deferred
    f({ importo: 1500, data: '2025-08-01', pagAnno: null }),              // emessa 2025, non ancora incassata → deferred
    f({ importo: 2000, data: '2025-11-01', pagAnno: 2026, pagMese: 2 }), // emessa 2025, incassata 2026 → deferred
    f({ importo: 500,  data: '2024-12-01', pagAnno: 2025, pagMese: 1 }), // emessa 2024, incassata 2025 → non deferred (annoEmissione != year)
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.deferred.length, 2);
  const deferredNull = result.deferred.find((d) => d.annoIncasso === null);
  const deferred2026 = result.deferred.find((d) => d.annoIncasso === 2026);
  assert.ok(deferredNull);
  assert.ok(deferred2026);
});

test('computeAccantonamento: effectiveRate=0 → tutto 0 senza NaN', () => {
  const fatture: AccFattura[] = [
    f({ importo: 3000, pagAnno: 2025, pagMese: 5, data: '2025-05-01' }),
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0 });
  assert.equal(result.totals.daAccantonare, 0);
  assert.equal(result.totals.gap, 0);
  result.cumulative.forEach((pt) => {
    assert.ok(!isNaN(pt.maturato), `maturato at month ${pt.month} is NaN`);
    assert.ok(!isNaN(pt.versato), `versato at month ${pt.month} is NaN`);
  });
});

test('computeAccantonamento: nota di credito (TD04) SOTTRAE dall\'imponibile, non azzerata (fix MEDIO #5)', () => {
  const fatture: AccFattura[] = [
    f({ importo: 1000, pagAnno: 2025, pagMese: 2, data: '2025-02-10', tipoDocumento: 'TD01', stato: 'pagata' }),
    f({ importo: 300, pagAnno: 2025, pagMese: 4, data: '2025-04-10', tipoDocumento: 'TD04', stato: 'pagata' }),
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0.30 });
  // Imponibile netto = 1000 - 300 = 700; daAccantonare = 700 * 0.30 = 210
  // (prima del fix: la NC era azzerata → 1000 / 300).
  assert.equal(result.totals.lordo, 700);
  assert.equal(result.totals.daAccantonare, 210);
  // La riga NC è negativa, non azzerata.
  const ncRow = result.rows.find((r) => r.lordo < 0);
  assert.ok(ncRow, 'la riga NC deve avere lordo negativo');
  assert.equal(ncRow!.lordo, -300);
  assert.equal(ncRow!.daAccantonare, -90);
});

test('computeAccantonamento: totale non va mai sotto zero (clamp solo sul totale)', () => {
  // NC maggiore dell\'imponibile positivo → il totale resta 0, non negativo.
  const fatture: AccFattura[] = [
    f({ importo: 100, pagAnno: 2025, pagMese: 2, data: '2025-02-10', tipoDocumento: 'TD01', stato: 'pagata' }),
    f({ importo: 500, pagAnno: 2025, pagMese: 4, data: '2025-04-10', tipoDocumento: 'TD04', stato: 'pagata' }),
  ];
  const result = computeAccantonamento({ fatture, pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.totals.lordo, 0);
  assert.equal(result.totals.daAccantonare, 0);
  result.cumulative.forEach((pt) => assert.ok(pt.maturato >= 0, `maturato ${pt.month} negativo`));
});

test('computeAccantonamento: label da clienteSnapshot (nome)', () => {
  const fattura: AccFattura = {
    importo: 1000,
    data: '2025-02-10',
    pagAnno: 2025,
    pagMese: 2,
    clienteSnapshot: JSON.stringify({ nome: 'Mario Rossi' }),
  };
  const result = computeAccantonamento({ fatture: [fattura], pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.rows[0]!.label, 'Mario Rossi');
});

test('computeAccantonamento: label fallback a numeroDisplay se clienteSnapshot null', () => {
  const fattura: AccFattura = {
    importo: 1000,
    data: '2025-02-10',
    pagAnno: 2025,
    pagMese: 2,
    clienteSnapshot: null,
    numeroDisplay: '2025/001',
  };
  const result = computeAccantonamento({ fatture: [fattura], pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.rows[0]!.label, '2025/001');
});

test('computeAccantonamento: mese da data quando pagMese è null/undefined', () => {
  const fattura: AccFattura = {
    importo: 1000,
    data: '2025-07-15', // mese 7
    pagAnno: 2025,
    pagMese: null,
  };
  const result = computeAccantonamento({ fatture: [fattura], pagamenti: [], year: 2025, effectiveRate: 0.30 });
  assert.equal(result.rows[0]!.mese, 7);
});

test('computeAccantonamento: no fatture → rows vuoto, totals a 0, deferred vuoto', () => {
  const result = computeAccantonamento({ fatture: [], pagamenti: [], year: 2025, effectiveRate: 0.25 });
  assert.equal(result.rows.length, 0);
  assert.equal(result.totals.lordo, 0);
  assert.equal(result.totals.daAccantonare, 0);
  assert.equal(result.totals.versato, 0);
  assert.equal(result.totals.gap, 0);
  assert.equal(result.deferred.length, 0);
  assert.equal(result.cumulative.length, 12);
});

test('computeAccantonamento: bollo/camera/inail/altro/undefined-tipo esclusi da versato', () => {
  // Solo tasse=300, contributi=150, misto=100 vanno in versato (tot=550).
  // bollo=500, camera=200, inail=100, altro=50, tipo=undefined=80 → tutti esclusi.
  const pagamenti: AccPagamento[] = [
    p({ data: '2025-03-01', importo: 300, tipo: 'tasse' }),
    p({ data: '2025-04-01', importo: 150, tipo: 'contributi' }),
    p({ data: '2025-05-01', importo: 100, tipo: 'misto' }),
    p({ data: '2025-05-15', importo: 500, tipo: 'bollo' }),
    p({ data: '2025-06-01', importo: 200, tipo: 'camera' }),
    p({ data: '2025-07-01', importo: 100, tipo: 'inail' }),
    p({ data: '2025-08-01', importo: 50,  tipo: 'altro' }),
    p({ data: '2025-09-01', importo: 80,  tipo: undefined }),
  ];
  const result = computeAccantonamento({ fatture: [], pagamenti, year: 2025, effectiveRate: 0.30 });

  // totals
  assert.equal(result.totals.versato, 550, 'solo tasse+contributi+misto contano');

  // cumulative: a maggio (idx=4) versato=300+150+100=550; bollo (maggio) escluso
  assert.equal(result.cumulative[4]!.versato, 550, 'bollo di maggio non incluso nel cumulato');
  // a dicembre (idx=11) ancora 550, nient'altro aggiunto dai tipi esclusi
  assert.equal(result.cumulative[11]!.versato, 550, 'tipi esclusi non aumentano il cumulato finale');
});
