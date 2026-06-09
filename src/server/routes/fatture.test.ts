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

// ───── Transizioni (Task 5) ─────

async function createBozza(app: any, headers: any, clienteId: string, data = '2026-03-01', righe = [{ descrizione: 'x', prezzoUnitario: 1000 }]) {
  return await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers), body: JSON.stringify({ clienteId, data, righe }),
  })).json() as any;
}

test('invia: assegna numero gap-free, due fatture → 2026/1 e 2026/2', async () => {
  const { app, headers, clienteId } = await makeApp();
  const a = await createBozza(app, headers, clienteId);
  const b = await createBozza(app, headers, clienteId);
  const ra = await app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers });
  const rb = await app.request(`/api/fatture/${b.id}/invia`, { method: 'POST', headers });
  assert.equal(ra.status, 200);
  const ja = (await ra.json()) as any;
  assert.equal(ja.numeroDisplay, '2026/1');
  assert.equal(ja.marcaDaBollo, true); // imponibile 1000 > 77,47 in forfettario
  assert.equal(((await rb.json()) as any).numeroDisplay, '2026/2');
});

test('invia: gap-free dopo delete di una bozza intermedia', async () => {
  const { app, headers, clienteId } = await makeApp();
  const a = await createBozza(app, headers, clienteId);
  const b = await createBozza(app, headers, clienteId);
  await app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers }); // 2026/1
  await app.request(`/api/fatture/${b.id}`, { method: 'DELETE', headers });      // elimino bozza b
  const c2 = await createBozza(app, headers, clienteId);
  const rc = await app.request(`/api/fatture/${c2.id}/invia`, { method: 'POST', headers });
  assert.equal(((await rc.json()) as any).numeroDisplay, '2026/2'); // niente buchi
});

test('invia: ritenuta in forfettario → 422 RITENUTA_FORFETTARIO', async () => {
  const { app, headers, clienteId } = await makeApp();
  const a = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId, data: '2026-03-01', ritenuta: 50, righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  const r = await app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers });
  assert.equal(r.status, 422);
  assert.equal(((await r.json()) as any).error.code, 'RITENUTA_FORFETTARIO');
});

test('paga: inviata → pagata con pagMese/pagAnno derivati; annulla torna inviata', async () => {
  const { app, headers, clienteId } = await makeApp();
  const a = await createBozza(app, headers, clienteId);
  await app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers });
  const rp = await app.request(`/api/fatture/${a.id}/paga`, {
    method: 'POST', headers: J(headers), body: JSON.stringify({ date: '2026-05-08' }),
  });
  assert.equal(rp.status, 200);
  const paid = (await rp.json()) as any;
  assert.equal(paid.stato, 'pagata');
  assert.equal(paid.pagMese, 5);
  assert.equal(paid.pagAnno, 2026);

  const ru = await app.request(`/api/fatture/${a.id}/annulla-pagamento`, { method: 'POST', headers });
  const back = (await ru.json()) as any;
  assert.equal(back.stato, 'inviata');
  assert.equal(back.pagMese, null);
});

test('transizioni illegali → 409', async () => {
  const { app, headers, clienteId } = await makeApp();
  const a = await createBozza(app, headers, clienteId);
  // paga su bozza → 409
  const r1 = await app.request(`/api/fatture/${a.id}/paga`, { method: 'POST', headers: J(headers), body: '{}' });
  assert.equal(r1.status, 409);
  // invia due volte → seconda 409
  await app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers });
  const r2 = await app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers });
  assert.equal(r2.status, 409);
});

test('invia concorrente sulla stessa bozza → un solo 200, niente buco di numerazione', async () => {
  const { app, headers, clienteId } = await makeApp();
  const a = await createBozza(app, headers, clienteId);
  // Due richieste /invia in parallelo sulla STESSA bozza: il guard sullo stato
  // deve essere atomico (dentro la transazione), altrimenti entrambe passano il
  // check esterno e la seconda riscrive il progressivo → buco (1 saltato).
  const [r1, r2] = await Promise.all([
    app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers }),
    app.request(`/api/fatture/${a.id}/invia`, { method: 'POST', headers }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409]); // esattamente una invia, l'altra bloccata
  const got = await (await app.request(`/api/fatture/${a.id}`, { headers })).json() as any;
  assert.equal(got.stato, 'inviata');
  assert.equal(got.progressivo, 1); // numerazione gap-free preservata
});

test('round-trip: aliquota/tipo/causale ritenuta rileggibili in GET', async () => {
  const { app, headers, clienteId } = await makeApp();
  const created = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({
      clienteId, data: '2026-03-01',
      righe: [{ descrizione: 'x', prezzoUnitario: 100 }],
      ritenuta: 20, aliquotaRitenuta: 20, tipoRitenuta: 'RT01', causaleRitenuta: 'A',
    }),
  })).json() as any;
  assert.equal(created.aliquotaRitenuta, 20);
  assert.equal(created.tipoRitenuta, 'RT01');
  assert.equal(created.causaleRitenuta, 'A');
  const got = await (await app.request(`/api/fatture/${created.id}`, { headers })).json() as any;
  assert.equal(got.aliquotaRitenuta, 20);
  assert.equal(got.tipoRitenuta, 'RT01');
  assert.equal(got.causaleRitenuta, 'A');
});

// ───── XML FatturaPA (Task 5B) ─────
import { profiles } from '../db/schema';
import { eq as eqDrizzle } from 'drizzle-orm';

async function setCedente(db: any, profileId: string) {
  await db.update(profiles).set({
    anagrafica: JSON.stringify({
      cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
      residenza: { indirizzo: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI' },
    }),
    attivita: JSON.stringify({ partita_iva: '00743110157' }),
  }).where(eqDrizzle(profiles.id, profileId));
}

async function clienteCompleto(db: any, profileId: string): Promise<string> {
  // Riusa il cliente creato da makeApp (stessa P.IVA -> niente collisione UNIQUE)
  // e gli aggiunge la sede richiesta dall'XML.
  const [existing] = await db.select().from(clienti).where(eqDrizzle(clienti.profileId, profileId)).limit(1);
  await db.update(clienti).set({
    indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO',
  }).where(eqDrizzle(clienti.id, existing.id));
  return existing.id as string;
}

test('GET /:id/xml — fattura inviata -> 200 application/xml + filename', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  await app.request(`/api/fatture/${f.id}/invia`, { method: 'POST', headers });

  const r = await app.request(`/api/fatture/${f.id}/xml`, { headers });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /application\/xml/);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="IT00743110157_/);
  const xml = await r.text();
  assert.match(xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
  assert.match(xml, /<Numero>2026\/1<\/Numero>/);
});

test('GET /:id/xml — bozza -> 422 FATTURA_NON_NUMERATA', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  const r = await app.request(`/api/fatture/${f.id}/xml`, { headers });
  assert.equal(r.status, 422);
  assert.equal(((await r.json()) as any).error.code, 'FATTURA_NON_NUMERATA');
});

test('GET /:id/xml — cedente incompleto -> 422 CEDENTE_INCOMPLETO con details', async () => {
  const { app, db, headers, profileId } = await makeApp();
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  await app.request(`/api/fatture/${f.id}/invia`, { method: 'POST', headers });
  const r = await app.request(`/api/fatture/${f.id}/xml`, { headers });
  assert.equal(r.status, 422);
  const body = (await r.json()) as any;
  assert.equal(body.error.code, 'CEDENTE_INCOMPLETO');
  assert.ok(Array.isArray(body.error.details) && body.error.details.length > 0);
});

test('GET /:id/xml — id altro profilo -> 404', async () => {
  const { app: appA, db: dbA, headers: hA, profileId: pA } = await makeApp('a@x.it');
  const { app: appB, headers: hB } = await makeApp('b@x.it');
  await setCedente(dbA, pA);
  const cId = await clienteCompleto(dbA, pA);
  const f = await (await appA.request('/api/fatture', {
    method: 'POST', headers: J(hA),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }),
  })).json() as any;
  const r = await appB.request(`/api/fatture/${f.id}/xml`, { headers: hB });
  assert.equal(r.status, 404);
});

// ───── Note di Credito TD04 (Slice 5C) ─────

async function inviaOriginale(app: any, headers: any, clienteId: string, data = '2026-03-01') {
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId, data, righe: [{ descrizione: 'Consulenza', prezzoUnitario: 1000 }] }),
  })).json() as any;
  await app.request(`/api/fatture/${f.id}/invia`, { method: 'POST', headers });
  return f;
}

test('POST /:id/nota-credito — crea NC bozza TD04 legata, snapshot copiato', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const orig = await inviaOriginale(app, headers, cId);
  const r = await app.request(`/api/fatture/${orig.id}/nota-credito`, {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ data: '2026-04-01', righe: [{ descrizione: 'Storno', prezzoUnitario: 1000 }] }),
  });
  assert.equal(r.status, 200);
  const nc = (await r.json()) as any;
  assert.equal(nc.tipoDocumento, 'TD04');
  assert.equal(nc.stato, 'bozza');
  assert.equal(nc.progressivo, null);
  assert.equal(nc.importo, 1000);
  assert.equal(nc.clienteSnapshot.nome, 'ACME Srl');
});

test('POST /:id/nota-credito — originale bozza → 409', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 100 }] }),
  })).json() as any;
  const r = await app.request(`/api/fatture/${f.id}/nota-credito`, {
    method: 'POST', headers: J(headers), body: JSON.stringify({ data: '2026-04-01', righe: [{ descrizione: 'x', prezzoUnitario: 100 }] }),
  });
  assert.equal(r.status, 409);
});

test('POST /:id/nota-credito — data NC anteriore → 422 NC_DATA_ANTERIORE', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const orig = await inviaOriginale(app, headers, cId, '2026-03-01');
  const r = await app.request(`/api/fatture/${orig.id}/nota-credito`, {
    method: 'POST', headers: J(headers), body: JSON.stringify({ data: '2026-02-01', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }),
  });
  assert.equal(r.status, 422);
  assert.equal(((await r.json()) as any).error.code, 'NC_DATA_ANTERIORE');
});

async function creaEInviaNC(app: any, headers: any, origId: string, prezzo: number, data = '2026-04-01') {
  const nc = await (await app.request(`/api/fatture/${origId}/nota-credito`, {
    method: 'POST', headers: J(headers), body: JSON.stringify({ data, righe: [{ descrizione: 'Storno', prezzoUnitario: prezzo }] }),
  })).json() as any;
  await app.request(`/api/fatture/${nc.id}/invia`, { method: 'POST', headers });
  return nc;
}

test('invia NC totale → originale stornata', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const orig = await inviaOriginale(app, headers, cId); // importo 1000
  await creaEInviaNC(app, headers, orig.id, 1000);
  const origAfter = await (await app.request(`/api/fatture/${orig.id}`, { headers })).json() as any;
  assert.equal(origAfter.stato, 'stornata');
});

test('invia NC parziale → originale resta inviata', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const orig = await inviaOriginale(app, headers, cId); // 1000
  await creaEInviaNC(app, headers, orig.id, 300);
  const origAfter = await (await app.request(`/api/fatture/${orig.id}`, { headers })).json() as any;
  assert.equal(origAfter.stato, 'inviata');
});

test('GET /:id/xml — NC TD04 → XML TD04, importi negativi, DatiFattureCollegate', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const orig = await inviaOriginale(app, headers, cId);
  const nc = await creaEInviaNC(app, headers, orig.id, 1000);
  const r = await app.request(`/api/fatture/${nc.id}/xml`, { headers });
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.match(xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(xml, /<ImponibileImporto>-1000\.00<\/ImponibileImporto>/);
  assert.match(xml, /<IdDocumento>2026\/1<\/IdDocumento>/);
});

test('POST /:id/nota-credito — su una NC (TD04) → 409 NC_ORIGINALE_NON_TD01', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const orig = await inviaOriginale(app, headers, cId);
  const nc = await creaEInviaNC(app, headers, orig.id, 300); // parziale: la NC resta inviata, non stornata
  const r = await app.request(`/api/fatture/${nc.id}/nota-credito`, {
    method: 'POST', headers: J(headers), body: JSON.stringify({ data: '2026-05-01', righe: [{ descrizione: 'x', prezzoUnitario: 100 }] }),
  });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as any).error.code, 'NC_ORIGINALE_NON_TD01');
});

// ───── Import XML (Slice 5E) ─────

function importItem(over: any = {}) {
  return {
    tipoDocumento: 'TD01', numero: '2026/1', data: '2026-03-01',
    annoProgressivo: 2026, progressivo: 1, numeroDisplay: '2026/1',
    righe: [{ descrizione: 'Consulenza', prezzoUnitario: 1000 }], importo: 1000,
    marcaDaBollo: true, modalitaPagamento: 'MP05',
    clienteSnapshot: { nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', nazione: 'IT' },
    ...over,
  };
}

test('POST /import-xml — importa fattura come inviata, match cliente esistente', async () => {
  const { app, headers } = await makeApp(); // makeApp crea un cliente con P.IVA 00743110157
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers), body: JSON.stringify({ items: [importItem()] }),
  });
  assert.equal(r.status, 200);
  const rep = (await r.json()) as any;
  assert.equal(rep.importate, 1);
  assert.equal(rep.clientiCreati, 0);
  const list = await (await app.request('/api/fatture', { headers })).json() as any[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.stato, 'inviata');
  assert.equal(list[0]!.numeroDisplay, '2026/1');
});

test('POST /import-xml — crea cliente nuovo se non matcha', async () => {
  const { app, db, headers, profileId } = await makeApp();
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ items: [importItem({
      clienteSnapshot: { nome: 'Nuovo Cliente Srl', tipoCliente: 'PG', partitaIva: '12345670785', nazione: 'IT' },
    })] }),
  });
  const rep = (await r.json()) as any;
  assert.equal(rep.importate, 1);
  assert.equal(rep.clientiCreati, 1);
  const rows = await db.select().from(clienti).where(eqDrizzle(clienti.profileId, profileId));
  assert.ok(rows.some((c) => c.partitaIva === '12345670785'));
});

test('POST /import-xml — re-import stesso file → tutto saltato (dedup)', async () => {
  const { app, headers } = await makeApp();
  const body = JSON.stringify({ items: [importItem()] });
  await app.request('/api/fatture/import-xml', { method: 'POST', headers: J(headers), body });
  const r2 = await app.request('/api/fatture/import-xml', { method: 'POST', headers: J(headers), body });
  const rep = (await r2.json()) as any;
  assert.equal(rep.importate, 0);
  assert.equal(rep.saltate.length, 1);
  assert.match(rep.saltate[0].motivo, /duplicat/i);
});

test('POST /import-xml — collisione progressivo (fattura diversa, stesso progressivo) → saltata', async () => {
  const { app, headers } = await makeApp();
  await app.request('/api/fatture/import-xml', { method: 'POST', headers: J(headers), body: JSON.stringify({ items: [importItem()] }) });
  // fattura DIVERSA (numeroDisplay diverso) ma stesso (anno, progressivo)
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ items: [importItem({ numero: 'ALT-1', numeroDisplay: '2026/1-ALT' })] }),
  });
  const rep = (await r.json()) as any;
  assert.equal(rep.importate, 0);
  assert.match(rep.saltate[0].motivo, /progressivo/i);
});

test('POST /import-xml — TD04 importata senza storno', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ items: [importItem({ tipoDocumento: 'TD04', numero: '2026/2', progressivo: 2, numeroDisplay: '2026/2' })] }),
  });
  const rep = (await r.json()) as any;
  assert.equal(rep.importate, 1);
  const list = await (await app.request('/api/fatture?stato=inviata', { headers })).json() as any[];
  assert.ok(list.some((f) => f.tipoDocumento === 'TD04'));
});

test('POST /import-xml — importo ricalcolato dal server (anti-falsificazione)', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ items: [importItem({ importo: 99999 })] }), // righe: 1×1000
  });
  assert.equal(((await r.json()) as any).importate, 1);
  const list = await (await app.request('/api/fatture', { headers })).json() as any[];
  assert.equal(list[0]!.importo, 1000); // ricalcolato da righe, non 99999
});

test('POST /import-xml — dedup per numeroDisplay (re-import formato N/AAAA → duplicato)', async () => {
  const { app, headers } = await makeApp();
  const it = importItem({ numero: '3/2026', numeroDisplay: '2026/3', progressivo: 3 });
  await app.request('/api/fatture/import-xml', { method: 'POST', headers: J(headers), body: JSON.stringify({ items: [it] }) });
  const r2 = await app.request('/api/fatture/import-xml', { method: 'POST', headers: J(headers), body: JSON.stringify({ items: [it] }) });
  const rep = (await r2.json()) as any;
  assert.equal(rep.importate, 0);
  assert.match(rep.saltate[0].motivo, /duplicat/i);
});
