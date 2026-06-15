// src/server/lib/session.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../db/test-helper';
import {
  createSession,
  getSession,
  needsRefresh,
  refreshSession,
  deleteSession,
  deleteAllSessionsForUser,
  deleteExpiredSessions,
  SESSION_TTL_MS,
  SESSION_REFRESH_INTERVAL_MS,
} from './session';

async function seedUser(client: import('@libsql/client').Client) {
  const userId = randomUUID();
  const profileId = randomUUID();
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
    args: [userId, 'x@y.it', 'h', 'X'],
  });
  await client.execute({
    sql: `INSERT INTO profiles (id, user_id, slug, display_name) VALUES (?, ?, ?, ?)`,
    args: [profileId, userId, 'default', 'X'],
  });
  return { userId, profileId };
}

test('createSession crea row e ritorna id + expiresAt 30gg', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const session = await createSession(db, userId, profileId);
  assert.match(session.id, /^[0-9a-f-]{36}$/);
  const expiresAt = new Date(session.expiresAt).getTime();
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(expiresAt - (now + thirtyDays)) < 5_000);
});

test('getSession ritorna la session se esiste e non scaduta', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const created = await createSession(db, userId, profileId);
  const fetched = await getSession(db, created.id);
  assert.ok(fetched);
  assert.equal(fetched.userId, userId);
  assert.equal(fetched.activeProfileId, profileId);
});

test('getSession ritorna null se scaduta e cancella la riga', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const created = await createSession(db, userId, profileId);
  // force expire
  await client.execute({
    sql: `UPDATE sessions SET expires_at = ? WHERE id = ?`,
    args: ['2000-01-01T00:00:00.000Z', created.id],
  });
  const fetched = await getSession(db, created.id);
  assert.equal(fetched, null);
  // cleanup
  const count = await client.execute({
    sql: `SELECT count(*) as c FROM sessions WHERE id = ?`,
    args: [created.id],
  });
  assert.equal((count.rows[0] as any).c, 0);
});

test('refreshSession aggiorna lastUsedAt e estende expiresAt', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const created = await createSession(db, userId, profileId);
  // forza un valore vecchio
  await client.execute({
    sql: `UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?`,
    args: ['2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z', created.id],
  });
  await refreshSession(db, created.id);
  const after = await getSession(db, created.id);
  assert.ok(after);
  assert.ok(new Date(after.lastUsedAt).getTime() > new Date('2025-12-31').getTime());
  assert.ok(new Date(after.expiresAt).getTime() > Date.now());
});

test('needsRefresh: false se appena rinnovata, true oltre 24h', () => {
  const now = Date.now();
  // appena creata: expiresAt = now + TTL → no refresh
  assert.equal(needsRefresh({ expiresAt: new Date(now + SESSION_TTL_MS).toISOString() }, now), false);
  // ultimo refresh 23h fa → ancora dentro l'intervallo, no refresh
  const h23 = 23 * 60 * 60 * 1000;
  assert.equal(needsRefresh({ expiresAt: new Date(now + SESSION_TTL_MS - h23).toISOString() }, now), false);
  // ultimo refresh 25h fa → refresh dovuto
  const h25 = 25 * 60 * 60 * 1000;
  assert.equal(needsRefresh({ expiresAt: new Date(now + SESSION_TTL_MS - h25).toISOString() }, now), true);
  // sanity: l'intervallo è 24h
  assert.equal(SESSION_REFRESH_INTERVAL_MS, 24 * 60 * 60 * 1000);
});

test('deleteExpiredSessions rimuove solo le sessioni scadute', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const fresh = await createSession(db, userId, profileId);
  const stale = await createSession(db, userId, profileId);
  await client.execute({
    sql: `UPDATE sessions SET expires_at = ? WHERE id = ?`,
    args: ['2000-01-01T00:00:00.000Z', stale.id],
  });
  await deleteExpiredSessions(db);
  const rows = await client.execute(`SELECT id FROM sessions`);
  assert.equal(rows.rows.length, 1);
  assert.equal((rows.rows[0] as any).id, fresh.id);
});

test('deleteSession rimuove la riga', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const s = await createSession(db, userId, profileId);
  await deleteSession(db, s.id);
  const fetched = await getSession(db, s.id);
  assert.equal(fetched, null);
});

test('deleteAllSessionsForUser rimuove tutte le sessions dell utente', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  await createSession(db, userId, profileId);
  await createSession(db, userId, profileId);
  await deleteAllSessionsForUser(db, userId);
  const r = await client.execute({
    sql: `SELECT count(*) as c FROM sessions WHERE user_id = ?`,
    args: [userId],
  });
  assert.equal((r.rows[0] as any).c, 0);
});
