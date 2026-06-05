// src/server/routes/tax.test.ts
//
// Endpoint GET /api/tax/rules + POST /api/tax/simulate.
// Test coverage:
//  - GET /api/tax/rules?year=2025 → catalog INPS + accontoRules + forfettarioRules
//  - POST /api/tax/simulate → scenario forfettario (year + substituteTax > 0)
//  - POST /api/tax/simulate con anno INPS mancante → 422 INPS_PARAMS_UNAVAILABLE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { taxRoute } from './tax';

async function setup() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'm@x.it',
    password: 'pwd-lunga-12345',
    name: 'M',
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.route('/api/tax', taxRoute);
  return { app, headers: { cookie: `lira_session=${session.id}` } };
}

test('GET /api/tax/rules?year=2025 → 200 con INPS + accontoRules + forfettarioRules', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/tax/rules?year=2025', { headers });
  assert.equal(r.status, 200);
  const body = (await r.json()) as {
    year: number;
    inpsArtcom: unknown;
    inpsGs: unknown;
    accontoRules: unknown;
    forfettarioRules: unknown;
  };
  assert.equal(body.year, 2025);
  assert.ok(body.inpsArtcom);
  assert.ok(body.inpsGs);
  assert.ok(body.accontoRules);
  assert.ok(body.forfettarioRules);
});

test('POST /api/tax/simulate → 200 con scenario', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/tax/simulate', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2025,
      grossCollected: 50000,
      settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, inpsMode: 'artigiani_commercianti' },
    }),
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { year: number; substituteTax: number };
  assert.equal(body.year, 2025);
  assert.ok(body.substituteTax > 0);
});

test('POST /api/tax/simulate con anno INPS mancante → 422', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/tax/simulate', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ year: 1999, grossCollected: 10000 }),
  });
  assert.equal(r.status, 422);
  const body = (await r.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'INPS_PARAMS_UNAVAILABLE');
});
