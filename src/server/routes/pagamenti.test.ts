// src/server/routes/pagamenti.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { pagamentiRoute } from './pagamenti';
import { yearSettings } from '../db/schema';

async function makeApp() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'm@x.it',
    password: 'pwd-lunga-12345',
    name: 'M',
  });
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
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.route('/api/pagamenti', pagamentiRoute);
  return {
    app,
    db,
    headers: { cookie: `lira_session=${session.id}` },
    profileId,
  };
}

test('POST + GET pagamenti CRUD round-trip', async () => {
  const { app, headers } = await makeApp();
  const r1 = await app.request('/api/pagamenti', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026,
      data: '2026-06-30',
      tipo: 'tasse',
      importo: 1500,
      scheduleKey: 'imposta_acc1_2026',
      descrizione: 'acconto 1',
    }),
  });
  assert.equal(r1.status, 200);
  const created = (await r1.json()) as { id: string };
  const r2 = await app.request('/api/pagamenti?year=2026', { headers });
  assert.equal(r2.status, 200);
  const list = (await r2.json()) as Array<{ id: string }>;
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, created.id);
});

test('POST con scheduleKey invalida → 400 INVALID_SCHEDULE_KEY', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026,
      data: '2026-06-30',
      tipo: 'tasse',
      importo: 100,
      scheduleKey: 'nonsense',
    }),
  });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_SCHEDULE_KEY');
});

test('POST con linkedKeys breakdown → 200', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026,
      data: '2026-06-30',
      tipo: 'misto',
      importo: 2600,
      linkedKeys: [
        { key: 'imposta_acc1_2026', amount: 1500 },
        { key: 'inps_fissi_2_2026', amount: 1100 },
      ],
    }),
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { linkedKeys: Array<{ key: string; amount: number }> };
  assert.equal(body.linkedKeys.length, 2);
  assert.equal(body.linkedKeys[0]!.key, 'imposta_acc1_2026');
});

test('quick-pay con scheduleKey valida + importo → crea pagamento', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti/quick-pay', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ scheduleKey: 'imposta_acc1_2026', importo: 1500 }),
  });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { scheduleKey: string; importo: number; tipo: string; year: number };
  assert.equal(body.scheduleKey, 'imposta_acc1_2026');
  assert.equal(body.importo, 1500);
  assert.equal(body.year, 2026);
  assert.equal(body.tipo, 'tasse');
});

test('quick-pay con scheduleKey unknown → 409', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti/quick-pay', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ scheduleKey: 'inesistente_2099', importo: 100 }),
  });
  assert.equal(r.status, 409);
  const body = (await r.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'PAGAMENTO_SCHEDULE_KEY_UNKNOWN');
});

test('DELETE rimuove il pagamento', async () => {
  const { app, headers } = await makeApp();
  const r1 = await app.request('/api/pagamenti', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026,
      data: '2026-06-30',
      tipo: 'tasse',
      importo: 100,
      scheduleKey: 'imposta_acc1_2026',
    }),
  });
  const id = ((await r1.json()) as { id: string }).id;
  const r2 = await app.request(`/api/pagamenti/${id}`, {
    method: 'DELETE',
    headers,
  });
  assert.equal(r2.status, 200);
  const r3 = await app.request('/api/pagamenti?year=2026', { headers });
  const list = (await r3.json()) as Array<unknown>;
  assert.equal(list.length, 0);
});
