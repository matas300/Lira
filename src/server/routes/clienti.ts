// src/server/routes/clienti.ts
//
// CRUD anagrafica clienti + autofill da P.IVA. Pattern routes/pagamenti.ts:
// requireSession, tutto scoped a c.get('activeProfileId'), validazione Zod.
//
// - is_default (integer 0/1) <-> isDefault (boolean) in toPublic.
// - Single-default garantito in db.transaction (<=1 default per profilo).
// - UNIQUE (profile,piva)/(profile,cf) violata -> 409 CLIENTE_DUPLICATE.

import { Hono } from 'hono';
import { and, asc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ClienteCreateInput, ClienteUpdateInput } from '@shared/schemas';
import { clienti } from '../db/schema';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { requireSession, type AuthEnv } from '../middleware/auth';

export const clientiRoute = new Hono<AuthEnv>();
clientiRoute.use('*', requireSession);

type ClienteRow = typeof clienti.$inferSelect;
type ClienteInsert = typeof clienti.$inferInsert;
type CreateBody = z.infer<typeof ClienteCreateInput>;

function toPublic(row: ClienteRow) {
  return {
    id: row.id,
    profileId: row.profileId,
    nome: row.nome,
    tipoCliente: row.tipoCliente,
    partitaIva: row.partitaIva,
    codiceFiscale: row.codiceFiscale,
    codiceSdi: row.codiceSdi ?? '0000000',
    pec: row.pec,
    indirizzo: row.indirizzo,
    cap: row.cap,
    citta: row.citta,
    provincia: row.provincia,
    nazione: row.nazione,
    descrizioneStandard: row.descrizioneStandard,
    isDefault: row.isDefault === 1,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  // Preferisci il codice strutturato del driver libSQL quando presente
  // (SQLITE_CONSTRAINT_UNIQUE), così NOT NULL / FOREIGN KEY non vengono
  // scambiati per duplicati. Fallback: match SOLO sul messaggio UNIQUE
  // (non sul generico "SQLITE_CONSTRAINT", che copre anche NOTNULL/FK).
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code === 'SQLITE_CONSTRAINT_UNIQUE';
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(msg);
}

async function clearOtherDefaults(tx: any, profileId: string, keepId: string): Promise<void> {
  await tx.update(clienti).set({ isDefault: 0 })
    .where(and(eq(clienti.profileId, profileId), ne(clienti.id, keepId)));
}

// GET /
clientiRoute.get('/', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const rows = await db.select().from(clienti)
    .where(eq(clienti.profileId, profileId))
    .orderBy(asc(clienti.nome));
  return c.json(rows.map(toPublic));
});

// POST /
clientiRoute.post('/', zJson(ClienteCreateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json') as CreateBody;
  const id = randomUUID();

  const values: ClienteInsert = {
    id, profileId,
    nome: body.nome,
    tipoCliente: body.tipoCliente,
    partitaIva: body.partitaIva ?? null,
    codiceFiscale: body.codiceFiscale ?? null,
    codiceSdi: body.codiceSdi,
    pec: body.pec ?? null,
    indirizzo: body.indirizzo ?? null,
    cap: body.cap ?? null,
    citta: body.citta ?? null,
    provincia: body.provincia ?? null,
    nazione: body.nazione,
    descrizioneStandard: body.descrizioneStandard ?? null,
    isDefault: body.isDefault ? 1 : 0,
    note: body.note ?? null,
  };

  try {
    if (body.isDefault) {
      await db.transaction(async (tx) => {
        await tx.insert(clienti).values(values);
        await clearOtherDefaults(tx, profileId, id);
      });
    } else {
      await db.insert(clienti).values(values);
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'CLIENTE_DUPLICATE', 'Cliente con stessa P.IVA o C.F. già presente');
    }
    throw err;
  }

  const [row] = await db.select().from(clienti).where(eq(clienti.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// PATCH /:id
clientiRoute.patch('/:id', zJson(ClienteUpdateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db.select().from(clienti)
    .where(and(eq(clienti.id, id), eq(clienti.profileId, profileId))).limit(1);
  if (!existing) throw new HttpError(404, 'CLIENTE_NOT_FOUND', `Cliente ${id} non trovato`);

  const u: Partial<ClienteInsert> = {};
  if (body.nome !== undefined) u.nome = body.nome;
  if (body.tipoCliente !== undefined) u.tipoCliente = body.tipoCliente;
  if (body.partitaIva !== undefined) u.partitaIva = body.partitaIva ?? null;
  if (body.codiceFiscale !== undefined) u.codiceFiscale = body.codiceFiscale ?? null;
  if (body.codiceSdi !== undefined) u.codiceSdi = body.codiceSdi;
  if (body.pec !== undefined) u.pec = body.pec ?? null;
  if (body.indirizzo !== undefined) u.indirizzo = body.indirizzo ?? null;
  if (body.cap !== undefined) u.cap = body.cap ?? null;
  if (body.citta !== undefined) u.citta = body.citta ?? null;
  if (body.provincia !== undefined) u.provincia = body.provincia ?? null;
  if (body.nazione !== undefined) u.nazione = body.nazione;
  if (body.descrizioneStandard !== undefined) u.descrizioneStandard = body.descrizioneStandard ?? null;
  if (body.note !== undefined) u.note = body.note ?? null;
  if (body.isDefault !== undefined) u.isDefault = body.isDefault ? 1 : 0;
  u.updatedAt = new Date().toISOString();

  try {
    if (body.isDefault === true) {
      await db.transaction(async (tx) => {
        await tx.update(clienti).set(u)
          .where(and(eq(clienti.id, id), eq(clienti.profileId, profileId)));
        await clearOtherDefaults(tx, profileId, id);
      });
    } else {
      await db.update(clienti).set(u)
        .where(and(eq(clienti.id, id), eq(clienti.profileId, profileId)));
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'CLIENTE_DUPLICATE', 'Cliente con stessa P.IVA o C.F. già presente');
    }
    throw err;
  }

  const [row] = await db.select().from(clienti).where(eq(clienti.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// DELETE /:id
clientiRoute.delete('/:id', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const [existing] = await db.select().from(clienti)
    .where(and(eq(clienti.id, id), eq(clienti.profileId, profileId))).limit(1);
  if (!existing) throw new HttpError(404, 'CLIENTE_NOT_FOUND', `Cliente ${id} non trovato`);
  await db.delete(clienti)
    .where(and(eq(clienti.id, id), eq(clienti.profileId, profileId)));
  return c.json({ ok: true });
});

// GET /lookup/:piva — handler added in Task 5. Leave this comment as the marker.
