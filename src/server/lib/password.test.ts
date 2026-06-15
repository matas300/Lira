// src/server/lib/password.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password';

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
});

test('verifyPassword ritorna false con password sbagliata', async () => {
  const hash = await hashPassword('right');
  assert.equal(await verifyPassword(hash, 'wrong'), false);
});

test('verifyPassword ritorna false con hash malformato', async () => {
  assert.equal(await verifyPassword('not-a-hash', 'qualsiasi'), false);
});

test('verify concorrenti passano dal semaforo: tutte risolvono col risultato giusto', async () => {
  // 5 verify in volo > MAX_CONCURRENT_VERIFY (2): le eccedenti vengono
  // accodate FIFO. Verifica assenza di deadlock e correttezza dei risultati.
  const h = await hashPassword('pw-concorrente');
  const results = await Promise.all([
    verifyPassword(h, 'pw-concorrente'),
    verifyPassword(h, 'sbagliata-1'),
    verifyPassword(h, 'pw-concorrente'),
    verifyPassword(h, 'sbagliata-2'),
    verifyPassword(h, 'pw-concorrente'),
  ]);
  assert.deepEqual(results, [true, false, true, false, true]);
});
