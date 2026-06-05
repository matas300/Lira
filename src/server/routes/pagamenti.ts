// src/server/routes/pagamenti.ts
//
// Endpoint REST per i pagamenti dell'utente. CRUD + azione quick-pay per
// l'integrazione con lo scadenziario.
//
// Boundary checks (Task 17):
//  - scheduleKey (se presente) e linkedKeys[*].key sono validati via
//    parseScheduleKey → 400 INVALID_SCHEDULE_KEY se malformata.
//  - quick-pay richiede scheduleKey. Se la chiave parsea ma la famiglia non
//    è nota → 409 PAGAMENTO_SCHEDULE_KEY_UNKNOWN. Se importo manca →
//    400 MISSING_IMPORTO (in attesa del lookup automatico, Slice 2B/futuro).
//
// Convenzioni:
//  - tutti gli endpoint sono scoped a c.get('activeProfileId').
//  - linkedKeys è persistito come JSON in colonna text; viene deserializzato
//    in array al ritorno.
//  - DELETE è hard (no soft delete) — i pagamenti sono dati operativi
//    cancellabili dall'utente.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PagamentoCreateInput, PagamentoQuickPayInput } from '@shared/schemas';
import { parseScheduleKey } from '@shared/schedule-keys';
import { pagamenti } from '../db/schema';
import { HttpError } from '../middleware/error';
import { requireSession, type AuthEnv } from '../middleware/auth';

export const pagamentiRoute = new Hono<AuthEnv>();

pagamentiRoute.use('*', requireSession);

// ─────────────────────────── helpers ───────────────────────────

type PagamentoRow = typeof pagamenti.$inferSelect;
type PagamentoInsert = typeof pagamenti.$inferInsert;
type PagamentoCreateBody = z.infer<typeof PagamentoCreateInput>;
type PagamentoQuickPayBody = z.infer<typeof PagamentoQuickPayInput>;
type LinkedKey = { key: string; amount: number };

function toPublic(row: PagamentoRow) {
  let linkedKeys: LinkedKey[] | null = null;
  if (row.linkedKeys) {
    try {
      const parsed = JSON.parse(row.linkedKeys) as unknown;
      if (Array.isArray(parsed)) {
        linkedKeys = parsed.filter(
          (x): x is LinkedKey =>
            !!x
            && typeof x === 'object'
            && typeof (x as LinkedKey).key === 'string'
            && typeof (x as LinkedKey).amount === 'number',
        );
      }
    } catch {
      linkedKeys = null;
    }
  }
  return {
    id: row.id,
    profileId: row.profileId,
    year: row.year,
    data: row.data,
    tipo: row.tipo,
    descrizione: row.descrizione,
    importo: row.importo,
    scheduleKey: row.scheduleKey,
    linkedKeys,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Valida una scheduleKey con parseScheduleKey. Lancia HttpError 400 se
 * malformata o famiglia non registrata. `null`/`undefined` passano.
 */
function assertValidScheduleKey(key: string | null | undefined, location: string): void {
  if (key == null) return;
  const parsed = parseScheduleKey(key);
  if (!parsed) {
    throw new HttpError(
      400,
      'INVALID_SCHEDULE_KEY',
      `${location}: scheduleKey "${key}" malformata o famiglia non riconosciuta.`,
    );
  }
}

/**
 * Inferisce un tipo "tasse"/"contributi"/etc dalla famiglia della schedule
 * key. Usato come default per quick-pay quando il client non specifica `tipo`.
 *
 * - imposta_* / bollo_* / camera → 'tasse'
 * - inps_* / contributi_* → 'contributi'
 * - inail → 'inail'
 * - fallback → 'altro'
 */
function inferTipoFromScheduleKey(key: string): 'tasse' | 'contributi' | 'inail' | 'altro' {
  const parsed = parseScheduleKey(key);
  if (!parsed) return 'altro';
  const f = parsed.family;
  if (f.startsWith('imposta_') || f.startsWith('bollo_') || f === 'camera') return 'tasse';
  if (f.startsWith('inps_') || f.startsWith('contributi_')) return 'contributi';
  if (f === 'inail') return 'inail';
  return 'altro';
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─────────────────────────── GET /?year=YYYY ───────────────────────────

pagamentiRoute.get('/', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const yearRaw = c.req.query('year');

  let rows: PagamentoRow[];
  if (yearRaw !== undefined) {
    const year = parseInt(yearRaw, 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new HttpError(400, 'INVALID_YEAR', `Anno non valido: "${yearRaw}"`);
    }
    rows = await db
      .select()
      .from(pagamenti)
      .where(and(eq(pagamenti.profileId, profileId), eq(pagamenti.year, year)))
      .orderBy(asc(pagamenti.data), asc(pagamenti.createdAt));
  } else {
    rows = await db
      .select()
      .from(pagamenti)
      .where(eq(pagamenti.profileId, profileId))
      .orderBy(asc(pagamenti.data), asc(pagamenti.createdAt));
  }

  return c.json(rows.map(toPublic));
});

// ─────────────────────────── POST / ───────────────────────────

pagamentiRoute.post('/', zValidator('json', PagamentoCreateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json') as PagamentoCreateBody;

  assertValidScheduleKey(body.scheduleKey, 'POST /api/pagamenti');
  if (body.linkedKeys) {
    for (let i = 0; i < body.linkedKeys.length; i++) {
      assertValidScheduleKey(body.linkedKeys[i]!.key, `POST /api/pagamenti linkedKeys[${i}]`);
    }
  }

  const id = randomUUID();
  const insertValues: PagamentoInsert = {
    id,
    profileId,
    year: body.year,
    data: body.data,
    tipo: body.tipo,
    descrizione: body.descrizione ?? null,
    importo: body.importo,
    scheduleKey: body.scheduleKey ?? null,
    linkedKeys: body.linkedKeys ? JSON.stringify(body.linkedKeys) : null,
    note: body.note ?? null,
  };
  await db.insert(pagamenti).values(insertValues);

  const [row] = await db.select().from(pagamenti).where(eq(pagamenti.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────────────────────── POST /quick-pay ───────────────────────────

pagamentiRoute.post('/quick-pay', zValidator('json', PagamentoQuickPayInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json') as PagamentoQuickPayBody;

  const parsed = parseScheduleKey(body.scheduleKey);
  if (!parsed) {
    // Famiglia sconosciuta o chiave malformata → in entrambi i casi non
    // possiamo agganciare il pagamento a una scadenza. 409 perché lo stato
    // dello scadenziario (catalogo famiglie) non consente l'operazione.
    throw new HttpError(
      409,
      'PAGAMENTO_SCHEDULE_KEY_UNKNOWN',
      `scheduleKey "${body.scheduleKey}" non riconosciuta dal catalogo scadenze.`,
    );
  }

  if (body.importo == null) {
    // In Slice 2B verrà introdotto il lookup dell'importo previsto dalla
    // schedule. Per ora richiediamo che il client lo passi esplicitamente.
    throw new HttpError(
      400,
      'MISSING_IMPORTO',
      'quick-pay richiede importo esplicito finché il lookup dello scadenziario non è disponibile.',
    );
  }

  const data = body.data ?? todayIso();
  const tipo = body.tipo ?? inferTipoFromScheduleKey(body.scheduleKey);
  const year = parsed.year;

  const id = randomUUID();
  const insertValues: PagamentoInsert = {
    id,
    profileId,
    year,
    data,
    tipo,
    descrizione: null,
    importo: body.importo,
    scheduleKey: body.scheduleKey,
    linkedKeys: null,
    note: null,
  };
  await db.insert(pagamenti).values(insertValues);

  const [row] = await db.select().from(pagamenti).where(eq(pagamenti.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────────────────────── PATCH /:id ───────────────────────────

const PagamentoPatchInput = PagamentoCreateInput.partial();

pagamentiRoute.patch('/:id', zValidator('json', PagamentoPatchInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  // Verifica che il record esista e appartenga al profilo
  const [existing] = await db
    .select()
    .from(pagamenti)
    .where(and(eq(pagamenti.id, id), eq(pagamenti.profileId, profileId)))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, 'PAGAMENTO_NOT_FOUND', `Pagamento ${id} non trovato`);
  }

  if (body.scheduleKey !== undefined && body.scheduleKey !== null) {
    assertValidScheduleKey(body.scheduleKey, `PATCH /api/pagamenti/${id}`);
  }
  if (body.linkedKeys) {
    for (let i = 0; i < body.linkedKeys.length; i++) {
      assertValidScheduleKey(body.linkedKeys[i]!.key, `PATCH /api/pagamenti/${id} linkedKeys[${i}]`);
    }
  }

  const updates: Partial<PagamentoInsert> = {};
  if (body.year !== undefined) updates.year = body.year;
  if (body.data !== undefined) updates.data = body.data;
  if (body.tipo !== undefined) updates.tipo = body.tipo;
  if (body.descrizione !== undefined) updates.descrizione = body.descrizione ?? null;
  if (body.importo !== undefined) updates.importo = body.importo;
  if (body.scheduleKey !== undefined) updates.scheduleKey = body.scheduleKey ?? null;
  if (body.linkedKeys !== undefined) {
    updates.linkedKeys = body.linkedKeys ? JSON.stringify(body.linkedKeys) : null;
  }
  if (body.note !== undefined) updates.note = body.note ?? null;
  updates.updatedAt = new Date().toISOString();

  await db
    .update(pagamenti)
    .set(updates)
    .where(and(eq(pagamenti.id, id), eq(pagamenti.profileId, profileId)));

  const [row] = await db.select().from(pagamenti).where(eq(pagamenti.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────────────────────── DELETE /:id ───────────────────────────

pagamentiRoute.delete('/:id', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(pagamenti)
    .where(and(eq(pagamenti.id, id), eq(pagamenti.profileId, profileId)))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, 'PAGAMENTO_NOT_FOUND', `Pagamento ${id} non trovato`);
  }

  await db
    .delete(pagamenti)
    .where(and(eq(pagamenti.id, id), eq(pagamenti.profileId, profileId)));

  return c.json({ ok: true });
});
