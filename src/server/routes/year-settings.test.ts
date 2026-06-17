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

test('PUT con tariffaGiornaliera: 250 → GET restituisce tariffaGiornaliera === 250', async () => {
  const { app, headers } = await makeApp();

  const putRes = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
      tariffaGiornaliera: 250,
    }),
  });
  assert.equal(putRes.status, 200);
  const putBody = await putRes.json();
  assert.equal(putBody.yearSettings.tariffaGiornaliera, 250);

  const getRes = await app.request('/api/year-settings/2026', { headers });
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.yearSettings.tariffaGiornaliera, 250);
});

test('PUT year-settings preserva budget_base_month esistente', async () => {
  const { app, db, headers, profileId } = await makeApp();
  const validBody = {
    regime: 'forfettario',
    coefficiente: 0.78,
    impostaSostitutiva: 0.15,
    inpsMode: 'gestione_separata',
    inpsCategoria: null,
    riduzione35: 0,
    riduzione35Comunicata: 0,
    riduzione35DataComunicazione: null,
    haRedditoDipendente: 0,
    limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
  };
  // 1) crea la riga year_settings
  let res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(validBody),
  });
  assert.equal(res.status, 200);
  // 2) imposta budget_base_month direttamente (simula il PUT budget)
  await db.update(yearSettings)
    .set({ budgetBaseMonth: 5 })
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2026)));
  // 3) ri-salva year-settings: NON deve azzerare budget_base_month
  res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(validBody),
  });
  assert.equal(res.status, 200);
  const [row] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2026))).limit(1);
  assert.equal(row!.budgetBaseMonth, 5);
});

test('FIX: PUT non azzera overrides.confirmedWarnings impostati da PATCH warnings', async () => {
  const { app, headers, db, profileId } = await makeApp();
  const validBody = {
    regime: 'forfettario',
    coefficiente: 0.78,
    impostaSostitutiva: 0.15,
    inpsMode: 'gestione_separata',
    inpsCategoria: null,
  };

  // 1) Crea la riga year_settings via PUT
  let res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(validBody),
  });
  assert.equal(res.status, 200);

  // 2) Dismisses warning C1 via PATCH warnings
  const patchRes = await app.request('/api/year-settings/2026/warnings', {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: ['C1'] }),
  });
  assert.equal(patchRes.status, 200);
  const patchBody = await patchRes.json();
  assert.deepEqual(patchBody.confirmedWarnings, ['C1']);

  // 3) PUT di nuovo (editor save, nessun overrides nel body)
  res = await app.request('/api/year-settings/2026', {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(validBody),
  });
  assert.equal(res.status, 200);

  // 4) Verifica che overrides.confirmedWarnings contenga ancora 'C1'
  const [row] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2026)))
    .limit(1);
  assert.ok(row, 'row deve esistere');
  const overrides = JSON.parse(row!.overrides ?? '{}') as { confirmedWarnings?: string[] };
  assert.ok(
    Array.isArray(overrides.confirmedWarnings) && overrides.confirmedWarnings.includes('C1'),
    `confirmedWarnings deve contenere 'C1', trovato: ${JSON.stringify(overrides.confirmedWarnings)}`,
  );
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
