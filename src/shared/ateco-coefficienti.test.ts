import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCoefficienteByAteco,
  COEFFICIENTI_VALIDI,
  isCoefficienteAmmesso,
} from './ateco-coefficienti';

test('getCoefficienteByAteco: 62.10.00 (programmazione) → 0.67', () => {
  assert.equal(getCoefficienteByAteco('62.10.00'), 0.67);
});

test('getCoefficienteByAteco: 47.91.10 (commercio al minuto) → 0.40', () => {
  assert.equal(getCoefficienteByAteco('47.91.10'), 0.40);
});

test('getCoefficienteByAteco: codice malformato (5 cifre) → null', () => {
  assert.equal(getCoefficienteByAteco('62.10'), null);
});

test('isCoefficienteAmmesso: include solo {0.40, 0.54, 0.62, 0.67, 0.78, 0.86}', () => {
  for (const c of [0.40, 0.54, 0.62, 0.67, 0.78, 0.86]) {
    assert.equal(isCoefficienteAmmesso(c), true);
  }
  assert.equal(isCoefficienteAmmesso(0.50), false);
  assert.equal(isCoefficienteAmmesso(1.0), false);
});

test('COEFFICIENTI_VALIDI è readonly array (Object.isFrozen)', () => {
  assert.equal(Object.isFrozen(COEFFICIENTI_VALIDI), true);
});
