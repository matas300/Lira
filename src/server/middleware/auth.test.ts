// src/server/middleware/auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createSession } from '../lib/session';
import { requireSession, type AuthEnv } from './auth';
import { errorHandler } from './error';

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

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.use('/protected/*', requireSession);
  app.get('/protected/who', (c) => c.json({ userId: c.get('userId'), profileId: c.get('activeProfileId') }));
  return app;
}

test('requireSession → 401 senza cookie', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/protected/who');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHENTICATED');
});

test('requireSession → 401 con session id inesistente', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/protected/who', {
    headers: { cookie: 'lira_session=non-esiste' },
  });
  assert.equal(res.status, 401);
});

test('requireSession → 200 con session valida e setta userId/profileId', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const session = await createSession(db, userId, profileId);
  const res = await makeApp(db).request('/protected/who', {
    headers: { cookie: `lira_session=${session.id}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, userId);
  assert.equal(body.profileId, profileId);
});

test('requireSession → session fresca: nessun refresh DB, nessun Set-Cookie', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const session = await createSession(db, userId, profileId);
  const res = await makeApp(db).request('/protected/who', {
    headers: { cookie: `lira_session=${session.id}` },
  });
  assert.equal(res.status, 200);
  // niente cookie rinnovato (refresh throttled: ultimo refresh < 24h fa)
  assert.equal(res.headers.get('set-cookie'), null);
  // expires_at invariato sul DB
  const row = await client.execute({
    sql: `SELECT expires_at FROM sessions WHERE id = ?`,
    args: [session.id],
  });
  assert.equal((row.rows[0] as any).expires_at, session.expiresAt);
});

test('requireSession → session "vecchia" >24h: rinnova expires_at e re-imposta il cookie', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const session = await createSession(db, userId, profileId);
  // simula ultimo refresh 2 giorni fa: expiresAt = now + 28gg (< TTL − 24h)
  const staleExpires = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString();
  await client.execute({
    sql: `UPDATE sessions SET expires_at = ? WHERE id = ?`,
    args: [staleExpires, session.id],
  });
  const res = await makeApp(db).request('/protected/who', {
    headers: { cookie: `lira_session=${session.id}` },
  });
  assert.equal(res.status, 200);
  // cookie re-impostato: stesso nome, nuovo Max-Age 30gg
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie?.includes(`lira_session=${session.id}`), 'cookie rinnovato presente');
  assert.ok(setCookie?.includes('Max-Age=2592000'), 'Max-Age 30 giorni');
  assert.ok(setCookie?.includes('HttpOnly'), 'HttpOnly');
  // expires_at rinnovato a ~now+30gg sul DB
  const row = await client.execute({
    sql: `SELECT expires_at FROM sessions WHERE id = ?`,
    args: [session.id],
  });
  const newExpires = new Date((row.rows[0] as any).expires_at).getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(newExpires - (Date.now() + thirtyDays)) < 5_000);
});
