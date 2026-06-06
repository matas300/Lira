import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ns, nn, nb, pctToFrac } from './normalize';

test('ns: trim, vuoto → null', () => {
  assert.equal(ns('  ciao '), 'ciao');
  assert.equal(ns(''), null);
  assert.equal(ns('   '), null);
  assert.equal(ns(null), null);
  assert.equal(ns(undefined), null);
});

test('nn: numerico, vuoto/non-numerico → null', () => {
  assert.equal(nn(10), 10);
  assert.equal(nn('10.5'), 10.5);
  assert.equal(nn(''), null);
  assert.equal(nn('abc'), null);
  assert.equal(nn(null), null);
});

test('nb: bool-ish → 0/1', () => {
  for (const v of [true, 1, '1']) assert.equal(nb(v), 1);
  for (const v of [false, 0, '0', '', null, undefined]) assert.equal(nb(v), 0);
});

test('pctToFrac: percentuale → frazione (>1 ⇒ /100)', () => {
  assert.equal(pctToFrac(67), 0.67);
  assert.equal(pctToFrac(15), 0.15);
  assert.equal(pctToFrac(0.67), 0.67);
  assert.equal(pctToFrac(''), null);
});
