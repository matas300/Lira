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

test('scoping: due profili nello STESSO db — B non vede né modifica il cliente di A', async () => {
  // Un solo db condiviso, due utenti/profili distinti: prova che il filtro
  // profileId nella WHERE isola davvero i dati (non solo l'assenza del record).
  const { db } = await createTestDb();
  const a = await createUserWithDefaultProfile({ db, email: 'a@x.it', password: 'pwd-lunga-12345', name: 'A' });
  const b = await createUserWithDefaultProfile({ db, email: 'b@x.it', password: 'pwd-lunga-12345', name: 'B' });
  const sa = await createSession(db, a.userId, a.profileId);
  const sb = await createSession(db, b.userId, b.profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/clienti', clientiRoute);
  const hA = { cookie: `lira_session=${sa.id}`, 'content-type': 'application/json' };
  const hB = { cookie: `lira_session=${sb.id}`, 'content-type': 'application/json' };

  const created = await (await app.request('/api/clienti', {
    method: 'POST', headers: hA, body: JSON.stringify({ nome: 'Cliente di A', partitaIva: '00743110157' }),
  })).json() as { id: string };

  // B non lo vede nella lista
  const listB = await (await app.request('/api/clienti', { headers: { cookie: hB.cookie } })).json() as unknown[];
  assert.equal(listB.length, 0);

  // B non lo può PATCHare → 404
  const rPatch = await app.request(`/api/clienti/${created.id}`, {
    method: 'PATCH', headers: hB, body: JSON.stringify({ citta: 'X' }),
  });
  assert.equal(rPatch.status, 404);

  // B non lo può DELETEare → 404
  const rDel = await app.request(`/api/clienti/${created.id}`, { method: 'DELETE', headers: { cookie: hB.cookie } });
  assert.equal(rDel.status, 404);

  // A invece lo vede ancora (non è stato toccato)
  const listA = await (await app.request('/api/clienti', { headers: { cookie: hA.cookie } })).json() as unknown[];
  assert.equal(listA.length, 1);
});

test('single-default via PATCH: promuovo B → A perde il default', async () => {
  const { app, headers } = await makeApp();
  await app.request('/api/clienti', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ nome: 'A', partitaIva: '00743110157', isDefault: true }),
  });
  const b = await (await app.request('/api/clienti', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ nome: 'B', partitaIva: '07643520567' }),
  })).json() as { id: string; isDefault: boolean };
  assert.equal(b.isDefault, false);

  const patched = await (await app.request(`/api/clienti/${b.id}`, {
    method: 'PATCH', headers: J(headers), body: JSON.stringify({ isDefault: true }),
  })).json() as { isDefault: boolean };
  assert.equal(patched.isDefault, true);

  const list = (await (await app.request('/api/clienti', { headers })).json()) as Array<{ nome: string; isDefault: boolean }>;
  const defaults = list.filter((c) => c.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0]!.nome, 'B');
});

test('GET /lookup/:piva — 200 con data (fetch + env stubbati)', async () => {
  const { app, headers } = await makeApp();
  const prevKey = process.env.OPENAPI_COMPANY_KEY;
  const prevFetch = globalThis.fetch;
  process.env.OPENAPI_COMPANY_KEY = 'k';
  globalThis.fetch = (async () => ({
    status: 200, ok: true,
    json: async () => ({ data: [{ companyName: 'ACME SRL' }] }),
  })) as unknown as typeof fetch;
  try {
    const r = await app.request('/api/clienti/lookup/00743110157', { headers });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { data: { nome: string } }).data.nome, 'ACME SRL');
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.OPENAPI_COMPANY_KEY;
    else process.env.OPENAPI_COMPANY_KEY = prevKey;
  }
});

test('GET /lookup/:piva — senza key → 503 AUTOFILL_UNAVAILABLE', async () => {
  const { app, headers } = await makeApp();
  const prevKey = process.env.OPENAPI_COMPANY_KEY;
  delete process.env.OPENAPI_COMPANY_KEY;
  try {
    const r = await app.request('/api/clienti/lookup/00743110157', { headers });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'AUTOFILL_UNAVAILABLE');
  } finally {
    if (prevKey !== undefined) process.env.OPENAPI_COMPANY_KEY = prevKey;
  }
});

test('GET /lookup/:piva — piva invalida → 400', async () => {
  const { app, headers } = await makeApp();
  const prevKey = process.env.OPENAPI_COMPANY_KEY;
  process.env.OPENAPI_COMPANY_KEY = 'k';
  try {
    const r = await app.request('/api/clienti/lookup/123', { headers });
    assert.equal(r.status, 400);
  } finally {
    if (prevKey === undefined) delete process.env.OPENAPI_COMPANY_KEY;
    else process.env.OPENAPI_COMPANY_KEY = prevKey;
  }
});
