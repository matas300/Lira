// src/server/routes/budget.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';
import { yearSettings } from '../db/schema';
import { budgetRoute } from './budget';

async function makeApp() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db, email: 'budget@test.it', password: 'pwd-lunga-12345', name: 'BudgetTest',
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/budget', budgetRoute);
  return { app, db, headers: { cookie: `lira_session=${session.id}` }, profileId };
}

function putBody(body: unknown, headers: Record<string, string>) {
  return { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

test('GET /api/budget/:year vuoto → baseMonth null, items []', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/budget/2026', { headers });
  assert.equal(res.status, 200);
  const body = await res.json() as { baseMonth: number | null; items: unknown[] };
  assert.equal(body.baseMonth, null);
  assert.deepEqual(body.items, []);
});

test('PUT poi GET → items e baseMonth coerenti, ordinati per ordine', async () => {
  const { app, headers } = await makeApp();
  const put = await app.request('/api/budget/2026', putBody({
    baseMonth: 4,
    items: [
      { nome: 'Cibo', importo: 300, auto: false, ordine: 1 },
      { nome: 'Affitto', importo: 500, auto: false, ordine: 0 },
    ],
  }, headers));
  assert.equal(put.status, 200);
  const res = await app.request('/api/budget/2026', { headers });
  const body = await res.json() as { baseMonth: number | null; items: Array<{ nome: string; importo: number; auto: boolean; ordine: number }> };
  assert.equal(body.baseMonth, 4);
  assert.equal(body.items.length, 2);
  assert.equal(body.items[0]!.nome, 'Affitto'); // ordine 0 prima
  assert.equal(body.items[1]!.nome, 'Cibo');
  assert.equal(body.items[0]!.auto, false);
});

test('PUT è replace: sostituisce le voci precedenti', async () => {
  const { app, headers } = await makeApp();
  await app.request('/api/budget/2026', putBody({
    baseMonth: null, items: [{ nome: 'Vecchia', importo: 100, auto: false, ordine: 0 }],
  }, headers));
  await app.request('/api/budget/2026', putBody({
    baseMonth: null, items: [{ nome: 'Nuova', importo: 200, auto: true, ordine: 0 }],
  }, headers));
  const res = await app.request('/api/budget/2026', { headers });
  const body = await res.json() as { items: Array<{ nome: string; auto: boolean }> };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]!.nome, 'Nuova');
  assert.equal(body.items[0]!.auto, true);
});

test('PUT baseMonth si scrive su year_settings se la riga esiste', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await db.insert(yearSettings).values({
    profileId, year: 2026, regime: 'forfettario', coefficiente: 0.78,
    impostaSostitutiva: 0.15, inpsMode: 'gestione_separata',
  });
  await app.request('/api/budget/2026', putBody({ baseMonth: 7, items: [] }, headers));
  const [row] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, 2026))).limit(1);
  assert.equal(row!.budgetBaseMonth, 7);
});

test('PUT baseMonth fuori range → 400', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/budget/2026', putBody({ baseMonth: 13, items: [] }, headers));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'VALIDATION');
});

test('PUT importo negativo → 400', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/budget/2026', putBody({
    baseMonth: null, items: [{ nome: 'X', importo: -5, auto: false, ordine: 0 }],
  }, headers));
  assert.equal(res.status, 400);
});

test('GET con anno invalido → 400 INVALID_YEAR', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/budget/1999', { headers });
  assert.equal(res.status, 400);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_YEAR');
});

test('GET senza sessione → 401', async () => {
  const { app } = await makeApp();
  const res = await app.request('/api/budget/2026');
  assert.equal(res.status, 401);
});
