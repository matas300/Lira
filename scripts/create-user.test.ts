import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile } from '../src/server/lib/users';

test('createUserWithDefaultProfile crea user + profilo default in transazione', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'X@Y.IT',
    password: 'una-password-lunga-1',
    name: 'Mattia',
  });
  assert.ok(userId);
  assert.ok(profileId);

  const u = await client.execute({ sql: `SELECT email, name FROM users WHERE id = ?`, args: [userId] });
  assert.equal((u.rows[0] as any).email, 'x@y.it'); // normalizzato lowercase
  assert.equal((u.rows[0] as any).name, 'Mattia');

  const p = await client.execute({ sql: `SELECT slug, display_name FROM profiles WHERE id = ?`, args: [profileId] });
  assert.equal((p.rows[0] as any).slug, 'default');
  assert.equal((p.rows[0] as any).display_name, 'Mattia');
});

test('createUserWithDefaultProfile fallisce su email duplicata', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-lunga-1234', name: 'A' });
  await assert.rejects(
    () => createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-lunga-1234', name: 'A2' }),
    /UNIQUE/,
  );
});
