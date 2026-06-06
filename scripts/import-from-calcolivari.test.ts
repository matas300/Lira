import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './import-from-calcolivari';

test('parseArgs: flag + files', () => {
  const a = parseArgs(['--user', 'm@x.it', '--slug', 'mattia', '--commit', 'a.json', 'b.json']);
  assert.equal(a.userEmail, 'm@x.it');
  assert.equal(a.slug, 'mattia');
  assert.equal(a.commit, true);
  assert.equal(a.skipInvalid, false);
  assert.deepEqual(a.files, ['a.json', 'b.json']);
});

test('parseArgs: dry-run di default', () => {
  const a = parseArgs(['--user', 'm@x.it', 'a.json']);
  assert.equal(a.commit, false);
});

test('parseArgs: --user mancante → errore', () => {
  assert.throws(() => parseArgs(['a.json']), /--user/);
});

test('parseArgs: nessun file → errore', () => {
  assert.throws(() => parseArgs(['--user', 'm@x.it']), /file/i);
});
