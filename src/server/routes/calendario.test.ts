// src/server/routes/calendario.test.ts
// TDD tests for calendario route: GET /api/calendario/:year, PUT /:year/:month/:day, DELETE /:year/:month/:day
// Run: npx tsx --test src/server/routes/calendario.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';
import { calendarioRoute } from './calendario';

async function makeApp() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'cal@test.it',
    password: 'pwd-lunga-12345',
    name: 'CalTest',
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.route('/api/calendario', calendarioRoute);
  return {
    app,
    db,
    headers: { cookie: `lira_session=${session.id}` },
    profileId,
  };
}

// GET anno vuoto
test('GET /api/calendario/:year senza entries → entries vuoto', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/2025', { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { year: number; entries: unknown[] };
  assert.equal(body.year, 2025);
  assert.deepEqual(body.entries, []);
});

// PUT upsert
test('PUT /api/calendario/2025/3/10 {activityCode:"F"} → 200 + entry restituita', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/2025/3/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'F' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; entry: { month: number; day: number; activityCode: string } };
  assert.equal(body.ok, true);
  assert.equal(body.entry.month, 3);
  assert.equal(body.entry.day, 10);
  assert.equal(body.entry.activityCode, 'F');
});

// GET dopo PUT
test('GET /api/calendario/2025 dopo PUT → entries contiene {month:3, day:10, activityCode:"F"}', async () => {
  const { app, headers } = await makeApp();
  // Prima inserisco
  await app.request('/api/calendario/2025/3/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'F' }),
  });
  // Poi leggo
  const res = await app.request('/api/calendario/2025', { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { year: number; entries: Array<{ month: number; day: number; activityCode: string }> };
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0]!.month, 3);
  assert.equal(body.entries[0]!.day, 10);
  assert.equal(body.entries[0]!.activityCode, 'F');
});

// Upsert sovrascrive
test('PUT due volte sullo stesso giorno → sovrascrive (upsert)', async () => {
  const { app, headers } = await makeApp();
  await app.request('/api/calendario/2025/3/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'F' }),
  });
  await app.request('/api/calendario/2025/3/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'M' }),
  });
  const res = await app.request('/api/calendario/2025', { headers });
  const body = await res.json() as { entries: Array<{ activityCode: string }> };
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0]!.activityCode, 'M');
});

// DELETE
test('DELETE /api/calendario/2025/3/10 → {ok:true}; GET non la contiene più', async () => {
  const { app, headers } = await makeApp();
  // Inserisco
  await app.request('/api/calendario/2025/3/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'F' }),
  });
  // Elimino
  const delRes = await app.request('/api/calendario/2025/3/10', {
    method: 'DELETE',
    headers,
  });
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json() as { ok: boolean };
  assert.equal(delBody.ok, true);
  // Verifico che non ci sia più
  const getRes = await app.request('/api/calendario/2025', { headers });
  const getBody = await getRes.json() as { entries: unknown[] };
  assert.deepEqual(getBody.entries, []);
});

// DELETE idempotente
test('DELETE su entry inesistente → {ok:true} (idempotente)', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/2025/3/10', {
    method: 'DELETE',
    headers,
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
});

// Validazione: activityCode invalido
test('PUT con activityCode invalido → 400', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/2025/3/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'INVALID' }),
  });
  assert.equal(res.status, 400);
});

// Validazione: anno invalido
test('GET con anno invalido → 400 INVALID_YEAR', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/1999', { headers });
  assert.equal(res.status, 400);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_YEAR');
});

// Validazione: mese invalido
test('PUT con mese invalido (13) → 400 INVALID_PARAMS', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/2025/13/10', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'F' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_PARAMS');
});

// Validazione: giorno invalido
test('PUT con giorno invalido (32) → 400 INVALID_PARAMS', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/calendario/2025/3/32', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ activityCode: 'F' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_PARAMS');
});

// Senza sessione → 401
test('GET senza sessione → 401', async () => {
  const { app } = await makeApp();
  const res = await app.request('/api/calendario/2025');
  assert.equal(res.status, 401);
});
