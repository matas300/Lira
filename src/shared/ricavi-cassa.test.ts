// src/shared/ricavi-cassa.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annoIncassoOf,
  meseIncassoOf,
  importoRicavoCassa,
  isIncassoSenzaAnno,
  sommaRicaviCassa,
  ricaviCassaPerMese,
  type RicavoFattura,
} from './ricavi-cassa';

test('annoIncassoOf: usa pag_anno se presente', () => {
  assert.equal(annoIncassoOf({ importo: 100, pagAnno: 2025, stato: 'pagata' }), 2025);
});

test('annoIncassoOf: ripiega su dataPagamento se pag_anno manca', () => {
  assert.equal(
    annoIncassoOf({ importo: 100, pagAnno: null, dataPagamento: '2024-05-10', stato: 'pagata' }),
    2024,
  );
});

test('annoIncassoOf: bozza → null (mai incassata)', () => {
  assert.equal(annoIncassoOf({ importo: 100, pagAnno: 2025, stato: 'bozza' }), null);
});

test('annoIncassoOf: incassata senza pag_anno né dataPagamento → null', () => {
  assert.equal(annoIncassoOf({ importo: 100, pagAnno: null, stato: 'pagata' }), null);
});

test('importoRicavoCassa: TD01 positivo, TD04 (nota credito) negativo', () => {
  assert.equal(importoRicavoCassa({ importo: 1000, tipoDocumento: 'TD01' }), 1000);
  assert.equal(importoRicavoCassa({ importo: 1000, tipoDocumento: 'TD04' }), -1000);
});

test('importoRicavoCassa: sottrae la ritenuta (0 per forfettario)', () => {
  assert.equal(importoRicavoCassa({ importo: 1000, ritenuta: 200, tipoDocumento: 'TD01' }), 800);
});

test('meseIncassoOf: pag_mese, poi dataPagamento, poi data', () => {
  assert.equal(meseIncassoOf({ importo: 1, pagMese: 7 }), 7);
  assert.equal(meseIncassoOf({ importo: 1, pagMese: null, dataPagamento: '2025-03-01' }), 3);
  assert.equal(meseIncassoOf({ importo: 1, pagMese: null, data: '2025-11-20' }), 11);
});

test('isIncassoSenzaAnno: pagata senza pag_anno né dataPagamento → true', () => {
  assert.equal(isIncassoSenzaAnno({ importo: 500, pagAnno: null, stato: 'pagata' }), true);
});

test('isIncassoSenzaAnno: bozza o con anno → false', () => {
  assert.equal(isIncassoSenzaAnno({ importo: 500, pagAnno: null, stato: 'bozza' }), false);
  assert.equal(isIncassoSenzaAnno({ importo: 500, pagAnno: 2025, stato: 'pagata' }), false);
  assert.equal(isIncassoSenzaAnno({ importo: 500, pagAnno: null, dataPagamento: '2025-01-01', stato: 'pagata' }), false);
  assert.equal(isIncassoSenzaAnno({ importo: 500, pagAnno: null, stato: 'inviata' }), false);
});

test('sommaRicaviCassa: somma incassate, sottrae NC, esclude bozze e altri anni', () => {
  const fatture: RicavoFattura[] = [
    { importo: 10000, pagAnno: 2025, stato: 'pagata', tipoDocumento: 'TD01' },
    { importo: 2000, pagAnno: 2025, stato: 'pagata', tipoDocumento: 'TD04' }, // NC -2000
    { importo: 5000, pagAnno: 2025, stato: 'bozza', tipoDocumento: 'TD01' },  // esclusa
    { importo: 3000, pagAnno: null, dataPagamento: '2025-06-01', stato: 'pagata', tipoDocumento: 'TD01' }, // backfill
    { importo: 9999, pagAnno: 2024, stato: 'pagata', tipoDocumento: 'TD01' }, // altro anno
  ];
  assert.equal(sommaRicaviCassa(fatture, 2025), 11000); // 10000 − 2000 + 3000
});

test('ricaviCassaPerMese: breakdown mensile con onlyPositive', () => {
  const fatture: RicavoFattura[] = [
    { importo: 1000, pagAnno: 2026, pagMese: 3, stato: 'pagata', tipoDocumento: 'TD01' },
    { importo: 200, pagAnno: 2026, pagMese: 3, stato: 'pagata', tipoDocumento: 'TD04' }, // -200
    { importo: 500, pagAnno: 2026, pagMese: 5, stato: 'pagata', tipoDocumento: 'TD01' },
  ];
  const m = ricaviCassaPerMese(fatture, 2026, { onlyPositive: true });
  assert.deepEqual(m, [{ month: 3, lordo: 800 }, { month: 5, lordo: 500 }]);
});
