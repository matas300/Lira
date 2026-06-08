// src/server/routes/fatture.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { clienti } from '../db/schema';
import { fattureRoute } from './fatture';

export async function makeApp(email = 'm@x.it') {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db, email, password: 'pwd-lunga-12345', name: 'M',
  });
  const session = await createSession(db, userId, profileId);
  // un cliente IT valido da referenziare
  const clienteId = randomUUID();
  await db.insert(clienti).values({
    id: clienteId, profileId, nome: 'ACME Srl', tipoCliente: 'PG',
    partitaIva: '00743110157', codiceSdi: '0000000', nazione: 'IT',
  });
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/fatture', fattureRoute);
  return { app, db, headers: { cookie: `lira_session=${session.id}` }, profileId, clienteId };
}

const J = (h: Record<string, string>) => ({ ...h, 'content-type': 'application/json' });

test('POST crea bozza senza numero, importo computed', async () => {
  const { app, headers, clienteId } = await makeApp();
  const r = await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({
      clienteId, data: '2026-03-01',
      righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500 }],
    }),
  });
  assert.equal(r.status, 200);
  const f = (await r.json()) as any;
  assert.equal(f.stato, 'bozza');
  assert.equal(f.progressivo, null);
  assert.equal(f.numeroDisplay, null);
  assert.equal(f.importo, 1000);
  assert.equal(f.righe.length, 1);
  assert.equal(f.clienteSnapshot.nome, 'ACME Srl');
});

test('GET lista + GET :id + PATCH contenuto bozza', async () => {
  const { app, headers, clienteId } = await makeApp();
  const created = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 100 }] }),
  })).json() as any;

  const list = await (await app.request('/api/fatture', { headers })).json() as any[];
  assert.equal(list.length, 1);

  const rp = await app.request(`/api/fatture/${created.id}`, {
    method: 'PATCH', headers: J(headers),
    body: JSON.stringify({ righe: [{ descrizione: 'y', quantita: 3, prezzoUnitario: 100 }] }),
  });
  assert.equal(rp.status, 200);
  assert.equal(((await rp.json()) as any).importo, 300);
});

test('DELETE bozza ok', async () => {
  const { app, headers, clienteId } = await makeApp();
  const created = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }),
  })).json() as any;
  const rd = await app.request(`/api/fatture/${created.id}`, { method: 'DELETE', headers });
  assert.equal(rd.status, 200);
  assert.equal(((await (await app.request('/api/fatture', { headers })).json()) as any[]).length, 0);
});

test('validazione → 400 VALIDATION (righe vuote)', async () => {
  const { app, headers, clienteId } = await makeApp();
  const r = await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId, data: '2026-03-01', righe: [] }),
  });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as any).error.code, 'VALIDATION');
});

test('scoping: id di altro profilo → 404', async () => {
  const { app: appA, headers: hA, clienteId } = await makeApp('a@x.it');
  const { app: appB, headers: hB } = await makeApp('b@x.it');
  const created = await (await appA.request('/api/fatture', {
    method: 'POST', headers: J(hA),
    body: JSON.stringify({ clienteId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }),
  })).json() as any;
  const r = await appB.request(`/api/fatture/${created.id}`, {
    method: 'PATCH', headers: J(hB), body: JSON.stringify({ note: 'x' }),
  });
  assert.equal(r.status, 404);
});
