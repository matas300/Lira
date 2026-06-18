import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { dichiarazioneRoute } from './dichiarazione';
import { authRoute } from './auth';
import { yearSettingsRoute } from './year-settings';
import { profiles, yearSettings } from '../db/schema';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/auth', authRoute);
  app.route('/api/dichiarazione', dichiarazioneRoute);
  return app;
}
async function login(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

test('GET /api/dichiarazione/:year → needsConfig se year-settings assente', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/dichiarazione/2025', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.needsConfig, true);
});

test('GET /api/dichiarazione/:year → dichiarazione con quadri quando configurato', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({
    anagrafica: JSON.stringify({ cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-01', residenza: { citta: 'Roma', provincia: 'RM' } }),
    attivita: JSON.stringify({ data_inizio_attivita: '2022-01-01' }),
  }).where(eq(profiles.id, p!.id));
  await db.insert(yearSettings).values({
    profileId: p!.id, year: 2025, regime: 'forfettario', coefficiente: 0.67,
    impostaSostitutiva: 0.15, inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    limiteForfettario: 85000, scadenziarioMetodo: 'storico',
  });

  const res = await app.request('/api/dichiarazione/2025', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.needsConfig, false);
  assert.equal(body.dichiarazione.frontespizio.codiceFiscale, 'RSSMRA80A01H501U');
  assert.ok(body.dichiarazione.quadroLM.length >= 8);
  assert.equal(body.dichiarazione.quadroRR.sezione, 'artigiani_commercianti');
});

test('GET /api/dichiarazione/:year → regime ordinario: warning REGIME_NON_FORFETTARIO, no crash', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({
    anagrafica: JSON.stringify({ cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-01', residenza: { citta: 'Roma', provincia: 'RM' } }),
  }).where(eq(profiles.id, p!.id));
  await db.insert(yearSettings).values({
    profileId: p!.id, year: 2025, regime: 'ordinario', coefficiente: 0.67,
    impostaSostitutiva: 0.15, inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    limiteForfettario: 85000, scadenziarioMetodo: 'storico',
  });

  const res = await app.request('/api/dichiarazione/2025', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.needsConfig, false);
  assert.ok(body.dichiarazione.warnings.some((w: { code: string; severity: string }) => w.code === 'REGIME_NON_FORFETTARIO' && w.severity === 'error'));
  assert.ok(body.dichiarazione.quadroLM.length >= 8); // non crasha, i quadri ci sono comunque
});

// ─────────────────────────── PATCH /:year (rettifiche 6C) ───────────────────────────

async function makePatchApp() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); }); // requireSession (nel route) popola userId/activeProfileId dal cookie
  app.onError(errorHandler);
  app.route('/api/dichiarazione', dichiarazioneRoute);
  app.route('/api/year-settings', yearSettingsRoute);
  const headers = { cookie: `lira_session=${session.id}`, 'content-type': 'application/json' };
  // crea year-settings 2025 forfettario
  await app.request('/api/year-settings/2025', { method: 'PUT', headers, body: JSON.stringify({
    regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  }) });
  return { app, headers, db, profileId };
}

test('PATCH /api/dichiarazione/:year salva override e li riflette nel GET', async () => {
  const { app, headers } = await makePatchApp();
  const patch = await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 100 }) });
  assert.equal(patch.status, 200);
  const get = await app.request('/api/dichiarazione/2025', { headers });
  const body = await get.json();
  const rx1 = body.dichiarazione.quadroRX.find((r: { key: string }) => r.key === 'RX1');
  assert.equal(rx1.value, 100);
  assert.equal(rx1.source, 'override');
});

test('PATCH con null rimuove l\'override (torna al default)', async () => {
  const { app, headers } = await makePatchApp();
  await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 100 }) });
  await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: null }) });
  const get = await app.request('/api/dichiarazione/2025', { headers });
  const body = await get.json();
  assert.equal(body.dichiarazione.quadroRX.find((r: { key: string }) => r.key === 'RX1').value, 0);
  assert.equal(body.dichiarazione.quadroRX.find((r: { key: string }) => r.key === 'RX1').source, 'zero');
});

test('PATCH su anno non configurato → 404', async () => {
  const { app, headers } = await makePatchApp();
  const res = await app.request('/api/dichiarazione/2030', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 1 }) });
  assert.equal(res.status, 404);
});

test('PATCH con valore negativo → 422', async () => {
  const { app, headers } = await makePatchApp();
  const res = await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditiImposta: -5 }) });
  assert.equal(res.status, 400); // zValidator → 400
});

test('PATCH dichiarazione preserva i sibling overrides (merge non-distruttivo 6C)', async () => {
  const { app, headers } = await makePatchApp();

  // 1) seed di un sibling override nella stessa colonna JSON: confirmedWarnings.
  const warn = await app.request('/api/year-settings/2025/warnings', {
    method: 'PATCH', headers, body: JSON.stringify({ confirm: ['X1'] }),
  });
  assert.equal(warn.status, 200);

  // 2) PATCH dichiarazione: scrive overrides.dichiarazione.creditoAnnoPrec.
  const patch = await app.request('/api/dichiarazione/2025', {
    method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 100 }),
  });
  assert.equal(patch.status, 200);

  // 3) entrambe le chiavi sopravvivono nella colonna overrides.
  const get = await app.request('/api/year-settings/2025', { headers });
  assert.equal(get.status, 200);
  const body = await get.json() as {
    yearSettings: { overrides: { confirmedWarnings?: string[]; dichiarazione?: { creditoAnnoPrec?: number } } | null };
  };
  const overrides = body.yearSettings.overrides;
  assert.ok(overrides, 'overrides deve essere presente');
  assert.deepEqual(overrides.confirmedWarnings, ['X1']); // sibling intatto
  assert.equal(overrides.dichiarazione?.creditoAnnoPrec, 100); // nuovo override applicato
});

test('PATCH dichiarazione con overrides JSON corrotto → 200 (parse difensivo, no 500)', async () => {
  const { app, headers, db, profileId } = await makePatchApp();

  // Sporca la colonna overrides con JSON non valido.
  await db.update(yearSettings).set({ overrides: '{not valid json' })
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2025)));

  const patch = await app.request('/api/dichiarazione/2025', {
    method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 100 }),
  });
  assert.equal(patch.status, 200);

  // L'override è stato ricostruito da capo e applicato.
  const get = await app.request('/api/dichiarazione/2025', { headers });
  const body = await get.json();
  const rx1 = body.dichiarazione.quadroRX.find((r: { key: string }) => r.key === 'RX1');
  assert.equal(rx1.value, 100);
});
