// src/server/routes/fatture.ts
//
// CRUD anagrafica fatture (Slice 5A). Pattern routes/clienti.ts:
// requireSession, scoped a c.get('activeProfileId'), zJson per envelope.
//
// - Create → bozza senza numero (progressivo/numeroDisplay null).
// - importo computed da righe; cliente_snapshot congelato da clienteId.
// - PATCH fiscale consentito solo su bozza (inviata/pagata: solo note/modalita).
// - DELETE solo su bozza. Transizioni (invia/paga/annulla) in coda al file.

import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FatturaCreateInput, FatturaUpdateInput, NotaCreditoCreateInput } from '@shared/schemas';
import { isNCDateValid, computeStorno } from '@shared/nc-sync';
import {
  computeImporto, isBolloDovuto,
  validateRitenutaForfettario, validateClienteSnapshot,
} from '@shared/fattura-logic';
import { fatture, clienti, yearSettings, profiles } from '../db/schema';
import type { Db } from '../db/client';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { requireSession, type AuthEnv } from '../middleware/auth';
import { readCedenteFromProfile } from '@shared/cedente';
import { buildFatturaXml, validateFatturaForXml, type FatturaXmlInput } from '@shared/fattura-xml';

export const fattureRoute = new Hono<AuthEnv>();
fattureRoute.use('*', requireSession);

type FatturaRow = typeof fatture.$inferSelect;
type FatturaInsert = typeof fatture.$inferInsert;
type CreateBody = z.infer<typeof FatturaCreateInput>;
type ClienteRow = typeof clienti.$inferSelect;

const FISCAL_FIELDS = ['clienteId', 'tipoDocumento', 'data', 'righe', 'ritenuta',
  'aliquotaRitenuta', 'tipoRitenuta', 'causaleRitenuta', 'contributoIntegrativo',
  'marcaDaBollo', 'bolloAddebitato'] as const;

export function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function toPublic(row: FatturaRow) {
  return {
    id: row.id,
    profileId: row.profileId,
    clienteId: row.clienteId,
    tipoDocumento: row.tipoDocumento,
    annoProgressivo: row.annoProgressivo,
    progressivo: row.progressivo,
    numeroDisplay: row.numeroDisplay,
    fatturaOriginaleId: row.fatturaOriginaleId,
    tipoStorno: row.tipoStorno,
    ncTotaleImporto: row.ncTotaleImporto,
    data: row.data,
    clienteSnapshot: parseJson<Record<string, unknown> | null>(row.clienteSnapshot, null),
    righe: parseJson<Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>>(row.righe, []),
    importo: row.importo,
    ritenuta: row.ritenuta,
    aliquotaRitenuta: row.aliquotaRitenuta,
    tipoRitenuta: row.tipoRitenuta,
    causaleRitenuta: row.causaleRitenuta,
    contributoIntegrativo: row.contributoIntegrativo,
    marcaDaBollo: row.marcaDaBollo === 1,
    bolloAddebitato: row.bolloAddebitato === 1,
    stato: row.stato,
    dataInvioSdi: row.dataInvioSdi,
    dataPagamento: row.dataPagamento,
    pagMese: row.pagMese,
    pagAnno: row.pagAnno,
    modalitaPagamento: row.modalitaPagamento,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function annoFromData(data: string): number {
  return Number(data.slice(0, 4));
}

/** Costruisce lo snapshot anagrafico da un cliente del profilo. 404 se assente. */
async function buildClienteSnapshot(
  db: Db, profileId: string, clienteId: string,
): Promise<Record<string, unknown>> {
  const [cli] = await db.select().from(clienti)
    .where(and(eq(clienti.id, clienteId), eq(clienti.profileId, profileId))).limit(1) as ClienteRow[];
  if (!cli) throw new HttpError(404, 'CLIENTE_NOT_FOUND', `Cliente ${clienteId} non trovato`);
  return {
    nome: cli.nome, tipoCliente: cli.tipoCliente, partitaIva: cli.partitaIva,
    codiceFiscale: cli.codiceFiscale, codiceSdi: cli.codiceSdi, pec: cli.pec,
    indirizzo: cli.indirizzo, cap: cli.cap, citta: cli.citta,
    provincia: cli.provincia, nazione: cli.nazione,
  };
}

// ─────────── GET / ───────────
fattureRoute.get('/', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const stato = c.req.query('stato');
  const conds = [eq(fatture.profileId, profileId)];
  if (stato) conds.push(eq(fatture.stato, stato));
  const rows = await db.select().from(fatture).where(and(...conds)).orderBy(desc(fatture.data), desc(fatture.createdAt));
  return c.json(rows.map(toPublic));
});

// ─────────── GET /:id ───────────
fattureRoute.get('/:id', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const [row] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!row) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  return c.json(toPublic(row));
});

// ─────────── POST / ───────────
fattureRoute.post('/', zJson(FatturaCreateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json') as CreateBody;
  const id = randomUUID();
  const snapshot = await buildClienteSnapshot(db, profileId, body.clienteId);

  const values: FatturaInsert = {
    id, profileId,
    clienteId: body.clienteId,
    tipoDocumento: body.tipoDocumento,
    annoProgressivo: annoFromData(body.data),
    progressivo: null,
    numeroDisplay: null,
    data: body.data,
    clienteSnapshot: JSON.stringify(snapshot),
    righe: JSON.stringify(body.righe),
    importo: computeImporto(body.righe),
    ritenuta: body.ritenuta,
    aliquotaRitenuta: body.aliquotaRitenuta ?? null,
    tipoRitenuta: body.tipoRitenuta ?? null,
    causaleRitenuta: body.causaleRitenuta ?? null,
    contributoIntegrativo: body.contributoIntegrativo,
    marcaDaBollo: body.marcaDaBollo ? 1 : 0,
    bolloAddebitato: body.bolloAddebitato ? 1 : 0,
    stato: 'bozza',
    modalitaPagamento: body.modalitaPagamento ?? null,
    note: body.note ?? null,
  };
  await db.insert(fatture).values(values);
  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── PATCH /:id ───────────
fattureRoute.patch('/:id', zJson(FatturaUpdateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!existing) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);

  const touchesFiscal = FISCAL_FIELDS.some((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (existing.stato !== 'bozza' && touchesFiscal) {
    throw new HttpError(409, 'FATTURA_LOCKED',
      'Solo note/modalità di pagamento sono modificabili dopo l\'invio');
  }

  const u: Partial<FatturaInsert> = {};
  if (body.clienteId !== undefined) {
    u.clienteId = body.clienteId;
    u.clienteSnapshot = JSON.stringify(await buildClienteSnapshot(db, profileId, body.clienteId));
  }
  if (body.tipoDocumento !== undefined) u.tipoDocumento = body.tipoDocumento;
  if (body.data !== undefined) { u.data = body.data; u.annoProgressivo = annoFromData(body.data); }
  if (body.righe !== undefined) { u.righe = JSON.stringify(body.righe); u.importo = computeImporto(body.righe); }
  if (body.ritenuta !== undefined) u.ritenuta = body.ritenuta;
  if (body.aliquotaRitenuta !== undefined) u.aliquotaRitenuta = body.aliquotaRitenuta ?? null;
  if (body.tipoRitenuta !== undefined) u.tipoRitenuta = body.tipoRitenuta ?? null;
  if (body.causaleRitenuta !== undefined) u.causaleRitenuta = body.causaleRitenuta ?? null;
  if (body.contributoIntegrativo !== undefined) u.contributoIntegrativo = body.contributoIntegrativo;
  if (body.marcaDaBollo !== undefined) u.marcaDaBollo = body.marcaDaBollo ? 1 : 0;
  if (body.bolloAddebitato !== undefined) u.bolloAddebitato = body.bolloAddebitato ? 1 : 0;
  if (body.modalitaPagamento !== undefined) u.modalitaPagamento = body.modalitaPagamento ?? null;
  if (body.note !== undefined) u.note = body.note ?? null;
  u.updatedAt = new Date().toISOString();

  await db.update(fatture).set(u).where(and(eq(fatture.id, id), eq(fatture.profileId, profileId)));
  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── DELETE /:id ───────────
fattureRoute.delete('/:id', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const [existing] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!existing) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  if (existing.stato !== 'bozza') {
    throw new HttpError(409, 'FATTURA_NOT_DELETABLE', 'Solo le bozze possono essere eliminate');
  }
  await db.delete(fatture).where(and(eq(fatture.id, id), eq(fatture.profileId, profileId)));
  return c.json({ ok: true });
});

// ════════════ Transizioni (state machine) ════════════

/** Regime dell'anno per il profilo; default forfettario se non configurato. */
async function regimeFor(db: Db, profileId: string, year: number): Promise<string> {
  const [ys] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year))).limit(1);
  return ys?.regime ?? 'forfettario';
}

// ─────────── POST /:id/invia ───────────
// Assegna il progressivo gap-free dentro una transazione (retry una volta su
// violazione UNIQUE), dopo le validazioni fail-fast (ritenuta/cliente).
fattureRoute.post('/:id/invia', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');

  const [f] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!f) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  if (f.stato !== 'bozza') throw new HttpError(409, 'FATTURA_NOT_INVIABILE', `Stato "${f.stato}" non inviabile`);

  const anno = annoFromData(f.data);
  const regime = await regimeFor(db, profileId, anno);

  // Validazioni fail-fast
  const ritErr = validateRitenutaForfettario(regime, f.ritenuta);
  if (ritErr) throw new HttpError(422, 'RITENUTA_FORFETTARIO', ritErr);
  const snapshot = parseJson<Record<string, unknown> | null>(f.clienteSnapshot, null);
  const cliErr = validateClienteSnapshot(snapshot as never);
  if (cliErr) throw new HttpError(422, 'CLIENTE_INCOMPLETO', cliErr);

  // Bollo dovuto (forfettario, imponibile > 77,47 €) → marca da bollo sulla fattura.
  const bolloFlag = isBolloDovuto(regime, f.importo) ? 1 : f.marcaDaBollo;

  const iso = todayIso();

  // Numerazione gap-free in un SINGOLO statement atomico: il progressivo è
  // calcolato inline come MAX(progressivo)+1 per (profilo, anno) e l'UPDATE
  // matcha solo se la fattura è ancora 'bozza'. Niente transazione né retry:
  // SQLite/libSQL serializza le scritture e ogni subquery vede lo stato
  // committato, quindi due /invia concorrenti (stessa o diverse fatture) non
  // possono collidere né lasciare buchi. Il perdente vede 0 righe → 409.
  const nextProg = sql`(select coalesce(max(${fatture.progressivo}), 0) + 1 from ${fatture} where ${fatture.profileId} = ${profileId} and ${fatture.annoProgressivo} = ${anno})`;
  const numberingSet = {
    progressivo: nextProg,
    numeroDisplay: sql`${String(anno)} || '/' || ${nextProg}`,
    stato: 'inviata',
    dataInvioSdi: iso,
    marcaDaBollo: bolloFlag,
    updatedAt: new Date().toISOString(),
  };
  const numberingWhere = and(
    eq(fatture.id, id), eq(fatture.profileId, profileId), eq(fatture.stato, 'bozza'),
  );

  // Applica lo storno all'originale (idempotente). `nc` è la NC TD04 appena
  // numerata; usato solo dentro la transazione del path NC.
  async function applyStorno(tx: any, nc: FatturaRow): Promise<void> {
    const [orig] = await tx.select().from(fatture)
      .where(and(eq(fatture.id, nc.fatturaOriginaleId!), eq(fatture.profileId, profileId))).limit(1);
    if (!orig) return; // originale cancellato (FK set null): niente storno
    const res = computeStorno({
      originaleImporto: orig.importo,
      originaleStato: orig.stato,
      originaleNcIds: parseJson<string[]>(orig.ncIds, []),
      originaleNcTotaleImporto: orig.ncTotaleImporto,
      ncId: nc.id,
      ncImporto: nc.importo,
    });
    const nowIso = new Date().toISOString();
    if (res.applied) {
      await tx.update(fatture).set({
        ncIds: JSON.stringify(res.ncIds),
        ncTotaleImporto: res.ncTotaleImporto,
        stato: res.stato,
        updatedAt: nowIso,
      }).where(and(eq(fatture.id, orig.id), eq(fatture.profileId, profileId)));
    }
    await tx.update(fatture).set({ tipoStorno: res.tipoStorno, updatedAt: nowIso })
      .where(and(eq(fatture.id, nc.id), eq(fatture.profileId, profileId)));
  }

  if (f.tipoDocumento === 'TD04' && f.fatturaOriginaleId) {
    // NC: numerazione + storno ATOMICI nella stessa transazione. Se lo storno
    // fallisce, il rollback annulla anche la numerazione (niente crash-between
    // che lascerebbe la NC inviata ma l'originale non stornato).
    const nc = f;
    await db.transaction(async (tx) => {
      const updated = await tx.update(fatture).set(numberingSet).where(numberingWhere).returning({ id: fatture.id });
      if (updated.length === 0) {
        throw new HttpError(409, 'FATTURA_NOT_INVIABILE', 'Fattura già inviata o non più in bozza');
      }
      await applyStorno(tx, nc);
    });
  } else {
    // TD01: numerazione atomica in singolo statement (no transazione → preserva
    // il comportamento concorrente di 5A: due /invia danno [200, 409], no 500).
    const updated = await db.update(fatture).set(numberingSet).where(numberingWhere).returning({ id: fatture.id });
    if (updated.length === 0) {
      throw new HttpError(409, 'FATTURA_NOT_INVIABILE', 'Fattura già inviata o non più in bozza');
    }
  }

  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── POST /:id/paga ───────────
const PagaInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

fattureRoute.post('/:id/paga', zJson(PagaInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const { date } = c.req.valid('json') as z.infer<typeof PagaInput>;

  const [f] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!f) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  if (f.stato !== 'inviata') throw new HttpError(409, 'FATTURA_NOT_PAGABILE', `Stato "${f.stato}" non pagabile`);

  const iso = date ?? todayIso();
  const yy = Number(iso.slice(0, 4));
  const mm = Number(iso.slice(5, 7));
  await db.update(fatture).set({
    stato: 'pagata', dataPagamento: iso, pagMese: mm, pagAnno: yy,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(fatture.id, id), eq(fatture.profileId, profileId)));

  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── POST /:id/annulla-pagamento ───────────
fattureRoute.post('/:id/annulla-pagamento', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');

  const [f] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!f) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  if (f.stato !== 'pagata') throw new HttpError(409, 'FATTURA_NOT_PAGATA', `Stato "${f.stato}" non annullabile`);

  await db.update(fatture).set({
    stato: 'inviata', dataPagamento: null, pagMese: null, pagAnno: null,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(fatture.id, id), eq(fatture.profileId, profileId)));

  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── POST /:id/nota-credito ───────────
fattureRoute.post('/:id/nota-credito', zJson(NotaCreditoCreateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const origId = c.req.param('id');
  const body = c.req.valid('json') as z.infer<typeof NotaCreditoCreateInput>;

  const [orig] = await db.select().from(fatture)
    .where(and(eq(fatture.id, origId), eq(fatture.profileId, profileId))).limit(1);
  if (!orig) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${origId} non trovata`);
  if (orig.stato === 'bozza' || !orig.numeroDisplay) {
    throw new HttpError(409, 'NC_ORIGINALE_NON_NUMERATA', 'La fattura originale dev\'essere inviata (numerata)');
  }
  if (orig.stato === 'stornata') {
    throw new HttpError(409, 'NC_ORIGINALE_STORNATA', 'La fattura è già stornata');
  }
  if (orig.tipoDocumento !== 'TD01') {
    throw new HttpError(409, 'NC_ORIGINALE_NON_TD01', 'La nota di credito può essere creata solo su una fattura TD01');
  }
  if (!isNCDateValid(body.data, orig.data)) {
    throw new HttpError(422, 'NC_DATA_ANTERIORE', `La data NC (${body.data}) non può precedere l'originale (${orig.data})`);
  }

  const id = randomUUID();
  const values: FatturaInsert = {
    id, profileId,
    clienteId: orig.clienteId,
    tipoDocumento: 'TD04',
    annoProgressivo: annoFromData(body.data),
    progressivo: null,
    numeroDisplay: null,
    data: body.data,
    clienteSnapshot: orig.clienteSnapshot,
    righe: JSON.stringify(body.righe),
    importo: computeImporto(body.righe),
    ritenuta: 0,
    contributoIntegrativo: 0,
    marcaDaBollo: 0,
    bolloAddebitato: 0,
    stato: 'bozza',
    fatturaOriginaleId: origId,
    origine: 'manuale',
    note: body.note ?? null,
  };
  await db.insert(fatture).values(values);
  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── GET /:id/xml ───────────

/** Nome file SDI: IT<piva>_<progressivo 5 alfanum>. */
function xmlFilename(piva: string, numeroDisplay: string): string {
  const prog = String(numeroDisplay).replace(/[^A-Za-z0-9]/g, '').slice(-5).padStart(5, '0');
  return `IT${String(piva).replace(/\D/g, '')}_${prog}`;
}

fattureRoute.get('/:id/xml', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');

  const [f] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!f) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  if (f.stato === 'bozza' || !f.numeroDisplay) {
    throw new HttpError(422, 'FATTURA_NON_NUMERATA', 'La fattura deve essere inviata (numerata) prima di generare l\'XML');
  }

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo non trovato');
  const anno = annoFromData(f.data);
  const regime = await regimeFor(db, profileId, anno);
  const cedRes = readCedenteFromProfile({
    anagrafica: parseJson<Record<string, unknown> | null>(profile.anagrafica, null),
    attivita: parseJson<Record<string, unknown> | null>(profile.attivita, null),
    regime,
  });
  if ('errors' in cedRes) {
    throw new HttpError(422, 'CEDENTE_INCOMPLETO', 'Dati del cedente incompleti per l\'XML', cedRes.errors);
  }

  let fatturaOriginale: { numero: string; data: string } | undefined;
  if (f.tipoDocumento === 'TD04') {
    if (!f.fatturaOriginaleId) {
      throw new HttpError(422, 'NC_ORIGINALE_MANCANTE', 'Nota di credito senza fattura originale collegata');
    }
    const [orig] = await db.select().from(fatture)
      .where(and(eq(fatture.id, f.fatturaOriginaleId), eq(fatture.profileId, profileId))).limit(1);
    if (!orig || !orig.numeroDisplay) {
      throw new HttpError(422, 'NC_ORIGINALE_MANCANTE', 'Fattura originale della NC non trovata o non numerata');
    }
    fatturaOriginale = { numero: orig.numeroDisplay, data: orig.data };
  }

  const pub = toPublic(f);
  const input: FatturaXmlInput = {
    cedente: cedRes.cedente,
    cliente: (pub.clienteSnapshot ?? {}) as FatturaXmlInput['cliente'],
    numero: pub.numeroDisplay!,
    data: pub.data,
    righe: pub.righe,
    importo: pub.importo,
    ritenuta: pub.ritenuta,
    aliquotaRitenuta: pub.aliquotaRitenuta ?? null,
    tipoRitenuta: pub.tipoRitenuta ?? null,
    causaleRitenuta: pub.causaleRitenuta ?? null,
    marcaDaBollo: pub.marcaDaBollo,
    bolloAddebitato: pub.bolloAddebitato,
    modalitaPagamento: pub.modalitaPagamento,
    contributoIntegrativo: pub.contributoIntegrativo,
    tipoDocumento: pub.tipoDocumento as 'TD01' | 'TD04',
    fatturaOriginale,
  };

  const errors = validateFatturaForXml(input);
  if (errors.length) {
    throw new HttpError(422, 'FATTURA_XML_INVALIDA', 'La fattura non è esportabile in XML', errors);
  }

  const xml = buildFatturaXml(input);
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${xmlFilename(cedRes.cedente.partitaIva, pub.numeroDisplay!)}.xml"`);
  return c.body(xml);
});
