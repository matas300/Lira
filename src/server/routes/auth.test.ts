// src/server/routes/auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { authRoute } from './auth';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/auth', authRoute);
  return app;
}

function getCookieValue(setCookie: string | null, name: string): string | undefined {
  if (!setCookie) return undefined;
  const m = setCookie.split(',').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m?.split(';')[0]?.split('=')[1];
}

test('login con credenziali corrette → 200 + cookie + body', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const res = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  assert.equal(res.status, 200);
  const cookie = getCookieValue(res.headers.get('set-cookie'), 'lira_session');
  assert.ok(cookie, 'cookie lira_session presente');
  const body = await res.json();
  assert.equal(body.user.email, 'a@b.it');
  assert.equal(body.profiles.length, 1);
  assert.equal(body.activeProfile.slug, 'default');
});

test('login con password sbagliata → 401', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'right-password-1', name: 'A' });
  const res = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'wrong-password-1' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_CREDENTIALS');
});

test('login con email inesistente → 401 (no user enumeration)', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ghost@x.it', password: 'qualsiasi-pw-12' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_CREDENTIALS');
});

test('me senza cookie → 401', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/api/auth/me');
  assert.equal(res.status, 401);
});

test('me con cookie valido → 200', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const loginRes = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  const cookieRaw = loginRes.headers.get('set-cookie')!.split(';')[0] ?? '';
  const meRes = await makeApp(db).request('/api/auth/me', { headers: { cookie: cookieRaw } });
  assert.equal(meRes.status, 200);
  const body = await meRes.json();
  assert.equal(body.user.email, 'a@b.it');
});

test('logout → 200, cookie cancellato, session invalidata', async () => {
  const { db, client } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const loginRes = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0] ?? '';
  const logoutRes = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logoutRes.status, 200);
  const meRes = await app.request('/api/auth/me', { headers: { cookie } });
  assert.equal(meRes.status, 401);
  const left = await client.execute(`SELECT count(*) as c FROM sessions`);
  assert.equal((left.rows[0] as any).c, 0);
});
