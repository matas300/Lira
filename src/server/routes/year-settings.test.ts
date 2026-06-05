// src/server/routes/year-settings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { yearSettingsRoute } from './year-settings';
import { profiles, yearSettings } from '../db/schema';

async function makeApp() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'm@x.it',
    password: 'pwd-lunga-12345',
    name: 'M',
  });
  // Setup data_inizio_attivita = 2018-04-01 → nel 2026 sono 8 anni (>5), A1 deve scattare
  await db
    .update(profiles)
    .set({ attivita: JSON.stringify({ data_inizio_attivita: '2018-04-01' }) })
    .where(eq(profiles.id, profileId));
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.route('/api/year-settings', yearSettingsRoute);
  return {
    app,
    db,
    headers: { cookie: `lira_session=${session.id}` },
    profileId,
  };
}

test('GET /api/year-settings/:year inesistente → 404', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2030', { headers });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, 'YEAR_SETTINGS_NOT_FOUND');
});

test('PUT /api/year-settings/:year 2026 forfettario valido → 200', async () => {
  const { app, headers, db, profileId } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.yearSettings.year, 2026);
  assert.equal(body.yearSettings.regime, 'forfettario');
  assert.equal(body.yearSettings.coefficiente, 0.67);

  // Verifica persistenza nel DB
  const rows = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2026)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.regime, 'forfettario');
});

test('PUT /api/year-settings/:year regime ordinario → 422 REGIME_NOT_SUPPORTED', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'ordinario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: null,
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'REGIME_NOT_SUPPORTED');
});

test('FIX A1: PUT sostitutiva 0.05 con attivita 2018 nel 2026 → 422 INVALID_SOSTITUTIVA_5', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.05,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_SOSTITUTIVA_5');
});

test('PUT coefficiente invalido (0.50) → 422 COEFFICIENTE_NON_AMMESSO', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario',
      coefficiente: 0.50,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'COEFFICIENTE_NON_AMMESSO');
});

test('PATCH /:year/warnings: confirm/unconfirm aggiorna overrides.confirmedWarnings', async () => {
  const { app, headers, db, profileId } = await makeApp();

  // Setup: prima crea un year_settings
  const putRes = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(putRes.status, 200);

  // Confirm un warning
  const res = await app.request('/api/year-settings/2026/warnings', {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: ['M1_RIDUZIONE_35_NON_COMUNICATA'] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.confirmedWarnings, ['M1_RIDUZIONE_35_NON_COMUNICATA']);

  // Verifica DB
  const [row] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2026)));
  assert.ok(row, 'row must exist');
  const overrides = JSON.parse(row!.overrides ?? '{}') as { confirmedWarnings?: string[] };
  assert.deepEqual(overrides.confirmedWarnings, ['M1_RIDUZIONE_35_NON_COMUNICATA']);

  // Unconfirm → deve sparire
  const res2 = await app.request('/api/year-settings/2026/warnings', {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ unconfirm: ['M1_RIDUZIONE_35_NON_COMUNICATA'] }),
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.deepEqual(body2.confirmedWarnings, []);
});
