import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { dichiarazioneRoute } from './dichiarazione';
import { authRoute } from './auth';
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
