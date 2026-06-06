// src/shared/validators.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPartitaIvaIT,
  isValidCodiceFiscaleFormat,
  isValidCodiceSdi,
  isValidPec,
} from './validators';

test('isValidPartitaIvaIT — P.IVA reali valide (check-digit corretto)', () => {
  assert.equal(isValidPartitaIvaIT('00743110157'), true);
  assert.equal(isValidPartitaIvaIT('07643520567'), true);
});

test('isValidPartitaIvaIT — check-digit errato', () => {
  assert.equal(isValidPartitaIvaIT('00743110158'), false);
});

test('isValidPartitaIvaIT — lunghezza/formato errato', () => {
  assert.equal(isValidPartitaIvaIT('123'), false);
  assert.equal(isValidPartitaIvaIT('0074311015a'), false);
  assert.equal(isValidPartitaIvaIT('007431101570'), false);
  assert.equal(isValidPartitaIvaIT(''), false);
});

test('isValidCodiceFiscaleFormat — solo formato 16 alfanumerici uppercase', () => {
  assert.equal(isValidCodiceFiscaleFormat('RSSMRA80A01H501U'), true);
  assert.equal(isValidCodiceFiscaleFormat('rssmra80a01h501u'), false);
  assert.equal(isValidCodiceFiscaleFormat('RSSMRA80A01H501'), false);
  assert.equal(isValidCodiceFiscaleFormat('RSSMRA80A01H501!'), false);
});

test('isValidCodiceSdi — PA 6 char, altri 7 char', () => {
  assert.equal(isValidCodiceSdi('UFXXXX', 'PA'), true);
  assert.equal(isValidCodiceSdi('0000000', 'PA'), false);
  assert.equal(isValidCodiceSdi('0000000', 'PG'), true);
  assert.equal(isValidCodiceSdi('ABC1234', 'Estero'), true);
  assert.equal(isValidCodiceSdi('ABC123', 'PF'), false);
  assert.equal(isValidCodiceSdi('abc1234', 'PG'), false);
});

test('isValidPec — email base', () => {
  assert.equal(isValidPec('mario@pec.it'), true);
  assert.equal(isValidPec('mario@pec'), false);
  assert.equal(isValidPec('mariopec.it'), false);
  assert.equal(isValidPec('a b@pec.it'), false);
});
