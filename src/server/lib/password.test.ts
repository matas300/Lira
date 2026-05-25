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
