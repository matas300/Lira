import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCONTO_RULES } from './acconto-rules';

test('ACCONTO_RULES: soglie esatte art. 17 DPR 435/2001', () => {
  assert.equal(ACCONTO_RULES.thresholdZero, 51.65);
  assert.equal(ACCONTO_RULES.thresholdSingle, 257.52);
});

test('ACCONTO_RULES: rate 50/50 per i forfettari (art. 58 DL 124/2019, Ris. AdE 93/E/2019)', () => {
  assert.deepEqual(ACCONTO_RULES.weights, [50, 50]);
});

test('ACCONTO_RULES: oggetto congelato (Object.freeze)', () => {
  assert.equal(Object.isFrozen(ACCONTO_RULES), true);
  assert.throws(() => {
    // @ts-expect-error mutazione intenzionale per il test
    ACCONTO_RULES.thresholdZero = 99;
  });
});

test('ACCONTO_RULES: weights congelato anche internamente', () => {
  assert.equal(Object.isFrozen(ACCONTO_RULES.weights), true);
});
