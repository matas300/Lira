// src/shared/nc-sync.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStorno, isNCDateValid, isOverStorno } from './nc-sync';

function base(over = {}) {
  return {
    originaleImporto: 500, originaleStato: 'inviata',
    originaleNcIds: [] as string[], originaleNcTotaleImporto: 0,
    ncId: 'nc1', ncImporto: 500, ...over,
  };
}

test('computeStorno — totale: stornata, tipoStorno totale, ncIds aggiornati', () => {
  const r = computeStorno(base());
  assert.equal(r.applied, true);
  assert.equal(r.tipoStorno, 'totale');
  assert.equal(r.ncTotaleImporto, 500);
  assert.deepEqual(r.ncIds, ['nc1']);
  assert.equal(r.stato, 'stornata');
});

test('computeStorno — parziale (100 su 500): stato resta inviata', () => {
  const r = computeStorno(base({ ncImporto: 100 }));
  assert.equal(r.tipoStorno, 'parziale');
  assert.equal(r.ncTotaleImporto, 100);
  assert.equal(r.stato, 'inviata');
});

test('computeStorno — due parziali fino al totale → stornata', () => {
  const r1 = computeStorno(base({ originaleImporto: 1000, ncId: 'a', ncImporto: 400, originaleStato: 'pagata' }));
  assert.equal(r1.tipoStorno, 'parziale');
  assert.equal(r1.stato, 'pagata');
  const r2 = computeStorno({
    originaleImporto: 1000, originaleStato: 'pagata',
    originaleNcIds: r1.ncIds, originaleNcTotaleImporto: r1.ncTotaleImporto,
    ncId: 'b', ncImporto: 600,
  });
  assert.equal(r2.ncTotaleImporto, 1000);
  assert.equal(r2.tipoStorno, 'totale');
  assert.equal(r2.stato, 'stornata');
});

test('computeStorno — idempotente: stessa ncId non raddoppia', () => {
  const r = computeStorno(base({ originaleNcIds: ['nc1'], originaleNcTotaleImporto: 500 }));
  assert.equal(r.applied, false);
  assert.equal(r.ncTotaleImporto, 500);
  assert.deepEqual(r.ncIds, ['nc1']);
  assert.equal(r.tipoStorno, 'totale');
});

test('computeStorno — tolleranza 0,01: 999,99 su 1000 → totale; 999,98 → parziale', () => {
  assert.equal(computeStorno(base({ originaleImporto: 1000, ncImporto: 999.99 })).tipoStorno, 'totale');
  assert.equal(computeStorno(base({ originaleImporto: 1000, ncImporto: 999.98 })).tipoStorno, 'parziale');
});

test('computeStorno — edge origImp<=0 → parziale, non stornata', () => {
  const r = computeStorno(base({ originaleImporto: 0, ncImporto: 0 }));
  assert.equal(r.tipoStorno, 'parziale');
  assert.equal(r.stato, 'inviata');
});

test('computeStorno — arrotondamento 2 decimali (3*33.333=99.999→100)', () => {
  const r = computeStorno(base({ originaleImporto: 100, ncImporto: 99.999 }));
  assert.equal(r.ncTotaleImporto, 100);
  assert.equal(r.tipoStorno, 'totale');
});

test('isOverStorno — blocca oltre il residuo, tolleranza 0,01 (art. 26 DPR 633/72)', () => {
  assert.equal(isOverStorno(1000, 0, 1200), true);    // singola eccedente
  assert.equal(isOverStorno(1000, 0, 1000), false);   // storno totale ok
  assert.equal(isOverStorno(1000, 0, 1000.01), false); // entro tolleranza
  assert.equal(isOverStorno(1000, 0, 1000.02), true);
  assert.equal(isOverStorno(1000, 600, 600), true);   // cumulato 1200 > 1000
  assert.equal(isOverStorno(1000, 600, 400), false);  // cumulato esatto
  assert.equal(isOverStorno(1000, 600, -400), false); // importo NC in valore assoluto
});

test('isNCDateValid — NC >= originale', () => {
  assert.equal(isNCDateValid('2026-03-15', '2026-03-15'), true);
  assert.equal(isNCDateValid('2026-04-01', '2026-03-15'), true);
  assert.equal(isNCDateValid('2026-03-14', '2026-03-15'), false);
  assert.equal(isNCDateValid(null, '2026-03-15'), true);
});
