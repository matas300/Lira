import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile, resetPassword } from '../src/server/lib/users';
import { createSession, getSession } from '../src/server/lib/session';
import { verifyPassword } from '../src/server/lib/password';
import { eq } from 'drizzle-orm';
import { users } from '../src/server/db/schema';

test('resetPassword cambia hash + invalida tutte le sessions', async () => {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'a@b.it',
    password: 'old-password-1234',
    name: 'A',
  });
  const s1 = await createSession(db, userId, profileId);
  const s2 = await createSession(db, userId, profileId);

  await resetPassword(db, 'a@b.it', 'new-password-5678');

  // hash cambiato
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  assert.equal(await verifyPassword(u!.passwordHash, 'new-password-5678'), true);
  assert.equal(await verifyPassword(u!.passwordHash, 'old-password-1234'), false);

  // sessions invalidate
  assert.equal(await getSession(db, s1.id), null);
  assert.equal(await getSession(db, s2.id), null);
});

test('resetPassword su email inesistente lancia errore', async () => {
  const { db } = await createTestDb();
  await assert.rejects(() => resetPassword(db, 'ghost@x.it', 'pw-1234'), /not found/i);
});
