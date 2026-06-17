// src/server/routes/profiles.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { profilesRoute } from './profiles';
import { authRoute } from './auth';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';
import { profiles } from '../db/schema';
import { eq } from 'drizzle-orm';

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/auth', authRoute);
  app.route('/api/profiles', profilesRoute);
  return app;
}

async function login(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  const setCookie = res.headers.get('set-cookie')!;
  const part = setCookie.split(';')[0];
  if (!part) throw new Error('set-cookie header missing or malformed');
  return part;
}

test('GET /api/profiles ritorna i profili dell utente loggato', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profiles.length, 1);
  assert.equal(body.profiles[0].slug, 'default');
});

test('POST /api/profiles crea un nuovo profilo', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'peru', displayName: 'Peru' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.slug, 'peru');
});

test('POST /api/profiles con body invalido → 400 envelope VALIDATION', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'NON Valido!', displayName: '' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'VALIDATION');
  assert.equal(body.error.message, 'Dati non validi');
  assert.ok(Array.isArray(body.error.details), 'details = issues Zod');
});

test('POST /api/profiles con slug duplicato → 409', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'default', displayName: 'X' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, 'SLUG_EXISTS');
});

test('POST /api/profiles/:slug/activate cambia activeProfile', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'peru', displayName: 'Peru' }),
  });
  const res = await app.request('/api/profiles/peru/activate', { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.activeProfile.slug, 'peru');

  const me = await app.request('/api/auth/me', { headers: { cookie } });
  const meBody = await me.json();
  assert.equal(meBody.activeProfile.slug, 'peru');
});

test('POST /api/profiles/:slug/activate con slug inesistente → 404', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles/ghost/activate', { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 404);
});

test('GET /api/profiles/active ritorna il profilo attivo con blob parsati', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);

  // semina blob JSON sul profilo default
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({
    anagrafica: JSON.stringify({ nome: 'Mario', residenza: { citta: 'Roma' } }),
    attivita: JSON.stringify({ partita_iva: '00743110157', regime_default: 'forfettario' }),
  }).where(eq(profiles.id, p!.id));

  const res = await app.request('/api/profiles/active', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.slug, 'default');
  assert.equal(body.profile.anagrafica.nome, 'Mario');
  assert.equal(body.profile.anagrafica.residenza.citta, 'Roma');
  assert.equal(body.profile.attivita.partita_iva, '00743110157');
  assert.equal(body.profile.attivita.regime_default, 'forfettario');
});

test('GET /api/profiles/active con blob null/malformato → oggetti vuoti', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({ anagrafica: 'not-json{', attivita: null }).where(eq(profiles.id, p!.id));

  const res = await app.request('/api/profiles/active', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.profile.anagrafica, {});
  assert.deepEqual(body.profile.attivita, {});
});
