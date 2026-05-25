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
