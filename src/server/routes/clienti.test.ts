// src/server/routes/clienti.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { clientiRoute } from './clienti';

async function makeApp(email = 'm@x.it') {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db, email, password: 'pwd-lunga-12345', name: 'M',
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/clienti', clientiRoute);
  return { app, db, headers: { cookie: `lira_session=${session.id}` }, profileId };
}

const J = (h: Record<string, string>) => ({ ...h, 'content-type': 'application/json' });

test('POST + GET + PATCH + DELETE round-trip', async () => {
  const { app, headers } = await makeApp();
  const r1 = await app.request('/api/clienti', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ nome: 'ACME Srl', partitaIva: '00743110157' }),
  });
  assert.equal(r1.status, 200);
  const c1 = (await r1.json()) as { id: string; isDefault: boolean; tipoCliente: string };
  assert.equal(typeof c1.id, 'string');
  assert.equal(c1.isDefault, false);
  assert.equal(c1.tipoCliente, 'PG');

  const rl = await app.request('/api/clienti', { headers });
  const list = (await rl.json()) as Array<{ id: string }>;
  assert.equal(list.length, 1);

  const rp = await app.request(`/api/clienti/${c1.id}`, {
    method: 'PATCH', headers: J(headers), body: JSON.stringify({ citta: 'Milano' }),
  });
  assert.equal(rp.status, 200);
  assert.equal(((await rp.json()) as { citta: string }).citta, 'Milano');

  const rd = await app.request(`/api/clienti/${c1.id}`, { method: 'DELETE', headers });
  assert.equal(rd.status, 200);
  const rl2 = await app.request('/api/clienti', { headers });
  assert.equal(((await rl2.json()) as unknown[]).length, 0);
});

test('validazione → 400 VALIDATION (P.IVA check-digit errato)', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/clienti', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ nome: 'X', partitaIva: '00743110158' }),
  });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'VALIDATION');
});

test('P.IVA duplicata → 409 CLIENTE_DUPLICATE', async () => {
  const { app, headers } = await makeApp();
  const body = JSON.stringify({ nome: 'A', partitaIva: '00743110157' });
  await app.request('/api/clienti', { method: 'POST', headers: J(headers), body });
  const r2 = await app.request('/api/clienti', { method: 'POST', headers: J(headers), body });
  assert.equal(r2.status, 409);
  assert.equal(((await r2.json()) as { error: { code: string } }).error.code, 'CLIENTE_DUPLICATE');
});

test('single-default: creo 2 clienti default → solo lultimo resta default', async () => {
  const { app, headers } = await makeApp();
  const a = await (await app.request('/api/clienti', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ nome: 'A', partitaIva: '00743110157', isDefault: true }),
  })).json() as { id: string };
  await app.request('/api/clienti', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ nome: 'B', partitaIva: '07643520567', isDefault: true }),
  });
  const list = (await (await app.request('/api/clienti', { headers })).json()) as Array<{ id: string; nome: string; isDefault: boolean }>;
  const defaults = list.filter((c) => c.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0]!.nome, 'B');
  assert.equal(list.find((c) => c.id === a.id)!.isDefault, false);
});

test('scoping: cliente di altro profilo → 404 su PATCH', async () => {
  const { app: appA, headers: hA } = await makeApp('a@x.it');
  const { headers: hB, app: appB } = await makeApp('b@x.it');
  const created = await (await appA.request('/api/clienti', {
    method: 'POST', headers: J(hA), body: JSON.stringify({ nome: 'A', partitaIva: '00743110157' }),
  })).json() as { id: string };
  const r = await appB.request(`/api/clienti/${created.id}`, {
    method: 'PATCH', headers: J(hB), body: JSON.stringify({ citta: 'X' }),
  });
  assert.equal(r.status, 404);
});
