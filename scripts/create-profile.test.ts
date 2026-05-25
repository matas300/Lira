import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile, createProfileForUser, listProfilesForUser } from '../src/server/lib/users';

test('createProfileForUser aggiunge un profilo al user esistente', async () => {
  const { db } = await createTestDb();
  const { userId } = await createUserWithDefaultProfile({
    db, email: 'a@b.it', password: 'pw-lunga-1234', name: 'A',
  });
  const p = await createProfileForUser(db, 'a@b.it', 'peru', 'Peru');
  assert.equal(p.slug, 'peru');
  const list = await listProfilesForUser(db, userId);
  assert.equal(list.length, 2);
});

test('createProfileForUser con email inesistente lancia errore', async () => {
  const { db } = await createTestDb();
  await assert.rejects(() => createProfileForUser(db, 'ghost@x.it', 'slug', 'Name'), /not found/i);
});
