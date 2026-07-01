// src/server/routes/scadenziario.test.ts
//
// Endpoint GET /api/scadenziario/:year — thin wrapper su
// `buildScadenziarioView`. I test coprono:
//  - happy path (200, 14 righe canoniche per anno 2026)
//  - presenza dei campi addizionali della view (methodComparison, warnings, rulesRef)
//  - 404 quando year_settings manca (l'errore arriva direttamente dal service)
//  - 401 senza cookie di sessione (middleware `requireSession`)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { scadenziarioRoute } from './scadenziario';
import { yearSettings, profiles } from '../db/schema';

async function setup(opts: { seed?: boolean } = {}) {
  const seed = opts.seed !== false;
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'm@x.it',
    password: 'pwd-lunga-12345',
    name: 'M',
  });
  await db
    .update(profiles)
    .set({
      attivita: JSON.stringify({ data_inizio_attivita: '2018-04-01' }),
    } as Partial<typeof profiles.$inferInsert>)
    .where(eq(profiles.id, profileId));
  if (seed) {
    await db.insert(yearSettings).values({
      profileId,
      year: 2025,
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
      riduzione35: 0,
      riduzione35Comunicata: 0,
      haRedditoDipendente: 0,
      limiteForfettario: 85000,
      scadenziarioMetodo: 'storico',
    } as typeof yearSettings.$inferInsert);
    await db.insert(yearSettings).values({
      profileId,
      year: 2026,
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
      riduzione35: 0,
      riduzione35Comunicata: 0,
      haRedditoDipendente: 0,
      limiteForfettario: 85000,
      scadenziarioMetodo: 'storico',
    } as typeof yearSettings.$inferInsert);
  }
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.route('/api/scadenziario', scadenziarioRoute);
  return { app, headers: { cookie: `lira_session=${session.id}` } };
}

test('GET /api/scadenziario/2026 → 200 con 14 righe', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/scadenziario/2026', { headers });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.rows.length, 14);
});

test('GET include methodComparison + warnings + rulesRef', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/scadenziario/2026', { headers });
  const body = await r.json();
  assert.ok(body.methodComparison);
  assert.ok(Array.isArray(body.warnings));
  assert.match(body.rulesRef, /\/api\/tax\/rules\?year=2026/);
});

test('GET 2030 senza riga propria ma profilo configurato → 200 (stima ereditata)', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/scadenziario/2030', { headers });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.rows.length, 14);
  assert.ok(
    body.warnings.some((w: { code: string }) => w.code === 'YEAR_SETTINGS_INHERITED'),
    'warning parametri stimati presente',
  );
});

test('GET con profilo senza ALCUNA year_settings → 404', async () => {
  const { app, headers } = await setup({ seed: false });
  const r = await app.request('/api/scadenziario/2026', { headers });
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.error.code, 'YEAR_SETTINGS_NOT_FOUND');
});

test('GET senza auth → 401', async () => {
  const { app } = await setup();
  const r = await app.request('/api/scadenziario/2026');
  assert.equal(r.status, 401);
});
