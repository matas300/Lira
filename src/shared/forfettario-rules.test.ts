import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORFETTARIO_RULES,
  ALIQUOTE_SOSTITUTIVA_AMMESSE,
  isSostitutivaAmmessa,
  isAnnoStartupValido,
} from './forfettario-rules';

test('FORFETTARIO_RULES: soglie 85k/100k (L. 197/2022)', () => {
  assert.equal(FORFETTARIO_RULES.sogliaIngresso, 85_000);
  assert.equal(FORFETTARIO_RULES.sogliaCessazioneImmediata, 100_000);
});

test('FORFETTARIO_RULES: aliquote sostitutiva freeze', () => {
  assert.equal(FORFETTARIO_RULES.sostitutivaStandard, 0.15);
  assert.equal(FORFETTARIO_RULES.sostitutivaStartup, 0.05);
  assert.equal(FORFETTARIO_RULES.startupMaxAnni, 5);
  assert.equal(Object.isFrozen(FORFETTARIO_RULES), true);
});

test('isSostitutivaAmmessa: solo 0.05 o 0.15', () => {
  assert.equal(isSostitutivaAmmessa(0.05), true);
  assert.equal(isSostitutivaAmmessa(0.15), true);
  assert.equal(isSostitutivaAmmessa(0.10), false);
  // Smoke-check sulla costante pubblica ALIQUOTE_SOSTITUTIVA_AMMESSE: la
  // funzione isSostitutivaAmmessa deve essere allineata con la lista esposta.
  for (const a of ALIQUOTE_SOSTITUTIVA_AMMESSE) {
    assert.equal(isSostitutivaAmmessa(a), true);
  }
});

test('isAnnoStartupValido: primi 5 anni dalla data inizio (incluso)', () => {
  assert.equal(isAnnoStartupValido(2020, 2020), true);
  assert.equal(isAnnoStartupValido(2020, 2024), true);
  assert.equal(isAnnoStartupValido(2020, 2025), false);
});
