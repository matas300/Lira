// src/shared/fattura-logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRigaTotale,
  computeImporto,
  isBolloDovuto,
  validateRitenutaForfettario,
  validateClienteSnapshot,
  SOGLIA_BOLLO,
} from './fattura-logic';

test('computeRigaTotale — quantità × prezzo', () => {
  assert.equal(computeRigaTotale({ descrizione: 'x', quantita: 3, prezzoUnitario: 10 }), 30);
  assert.equal(computeRigaTotale({ descrizione: 'x', quantita: 1, prezzoUnitario: 0 }), 0);
});

test('computeImporto — somma righe, arrotondato a 2 decimali', () => {
  assert.equal(computeImporto([
    { descrizione: 'a', quantita: 2, prezzoUnitario: 10.005 },
    { descrizione: 'b', quantita: 1, prezzoUnitario: 5 },
  ]), 25.01);
  assert.equal(computeImporto([]), 0);
});

test('isBolloDovuto — forfettario e imponibile > 77,47 (strict)', () => {
  assert.equal(isBolloDovuto('forfettario', 77.47), false); // soglia esclusa
  assert.equal(isBolloDovuto('forfettario', 77.48), true);
  assert.equal(isBolloDovuto('forfettario', 1000), true);
  assert.equal(isBolloDovuto('ordinario', 1000), false); // bollo non in questo path
  assert.equal(SOGLIA_BOLLO, 77.47);
});

test('validateRitenutaForfettario — blocca ritenuta>0 in forfettario', () => {
  assert.equal(validateRitenutaForfettario('forfettario', 50) !== null, true);
  assert.equal(validateRitenutaForfettario('forfettario', 0), null);
  assert.equal(validateRitenutaForfettario('ordinario', 50), null);
});

test('validateClienteSnapshot — cliente IT senza P.IVA né CF → errore', () => {
  assert.equal(validateClienteSnapshot({ nazione: 'IT' }) !== null, true);
  assert.equal(validateClienteSnapshot({ nazione: 'IT', partitaIva: '00743110157' }), null);
  assert.equal(validateClienteSnapshot({ nazione: 'IT', codiceFiscale: 'RSSMRA80A01H501U' }), null);
  assert.equal(validateClienteSnapshot({ nazione: 'DE' }), null); // estero ok
  assert.equal(validateClienteSnapshot(null), null);
});
