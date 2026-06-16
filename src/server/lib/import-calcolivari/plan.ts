import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users, profiles } from '../../db/schema';
import { detect } from './detect';
import { extractAll } from './extract';
import { mapAll } from './map';
import { newId } from './identity';
import { ImportError } from './errors';
import { CHILD_ENTITIES } from './registry';
import type { EntityPlan, ImportPlan, ImportIssue, MappedRows, ProfileOp } from './types';

const IGNORE = new Set(['createdAt', 'updatedAt']);

function countNonNull(o: any): number {
  return Object.values(o).filter((v) => v != null && v !== '').length;
}

function dedupRicher(rows: any[], keyOf: (r: any) => string): any[] {
  const m = new Map<string, any>();
  for (const r of rows) {
    const k = keyOf(r);
    const ex = m.get(k);
    if (!ex || countNonNull(r) > countNonNull(ex)) m.set(k, r);
  }
  return [...m.values()];
}

function rowDiffers(mapped: any, existing: any): boolean {
  for (const k of Object.keys(mapped)) {
    if (IGNORE.has(k)) continue;
    if ((mapped[k] ?? null) !== (existing[k] ?? null)) return true;
  }
  return false;
}

export async function buildImportPlan(
  db: Db,
  inputs: unknown[],
  opts: { userEmail: string; slug?: string },
): Promise<ImportPlan> {
  const email = opts.userEmail.toLowerCase().trim();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new ImportError('USER_NOT_FOUND', `USER_NOT_FOUND: Utente "${opts.userEmail}" non trovato. Crea con: npm run create-user -- ${opts.userEmail} <password>`);

  const exps = inputs.map(detect);
  const profileName = exps[0]!.profileName;
  const slug = opts.slug ?? profileName.toLowerCase();

  const [existing] = await db.select().from(profiles).where(and(eq(profiles.userId, user.id), eq(profiles.slug, slug))).limit(1);
  const profileId = existing?.id ?? newId();

  const issues: ImportIssue[] = [];
  const mappedList = exps.map((e) => {
    const r = mapAll(extractAll(e), { profileId, userId: user.id, slug });
    issues.push(...r.issues);
    return r.rows;
  });
  const merged = mergeMapped(mappedList);

  const profileRow = merged.profiles[0] ?? { id: profileId, userId: user.id, slug, displayName: slug };
  let profileOp: ProfileOp = 'insert';
  if (existing) profileOp = rowDiffers(profileRow, existing) ? 'update' : 'identical';

  const entities: Record<string, EntityPlan> = {};
  for (const spec of CHILD_ENTITIES) {
    const rows = spec.rowsOf(merged);
    const existingRows: any[] = profileId === existing?.id
      ? await db.select().from(spec.table).where(eq(spec.table.profileId, profileId))
      : [];
    const byKey = new Map(existingRows.map((r) => [spec.keyOf(r), r]));
    const byAlt = new Map<string, any>();
    if (spec.altKeysOf) {
      for (const r of existingRows) for (const ak of spec.altKeysOf(r)) byAlt.set(ak, r);
    }
    const ep: EntityPlan = { entity: spec.name, inserts: [], updates: [], identical: 0 };
    for (const row of rows) {
      let ex = byKey.get(spec.keyOf(row));
      if (!ex && spec.altKeysOf) {
        for (const ak of spec.altKeysOf(row)) {
          const cand = byAlt.get(ak);
          if (cand) { ex = cand; row.id = cand.id; break; } // riconciliazione: stesso cliente logico (P.IVA/CF), id diverso → update
        }
      }
      if (!ex) ep.inserts.push(row);
      else if (rowDiffers(row, ex)) ep.updates.push({ ...row, id: ex.id ?? row.id });
      else ep.identical++;
    }
    entities[spec.name] = ep;
  }

  return { profileName, userId: user.id, profileId, slug, profileOp, profileRow, entities, issues };
}

// Lira impone numerazione unica (profilo, anno, progressivo). I dati CalcoliVari
// hanno molte fatture distinte con lo stesso progressivo (tipicamente 0 per le
// fatture mensili/legacy importate in blocco). Rinumeriamo per anno ordinando per
// data (tiebreak su id per determinismo): 1..N gap-free, aggiornando numeroDisplay.
function renumberFattureByYear(rows: any[]): any[] {
  const byYear = new Map<number, any[]>();
  for (const r of rows) {
    const y = r.annoProgressivo ?? 0;
    const bucket = byYear.get(y) ?? [];
    bucket.push(r);
    byYear.set(y, bucket);
  }
  const out: any[] = [];
  for (const [year, list] of byYear) {
    list.sort((a, b) => {
      const da = String(a.data ?? ''), db = String(b.data ?? '');
      if (da !== db) return da < db ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    list.forEach((r, i) => {
      r.progressivo = i + 1;
      r.numeroDisplay = `${year}/${i + 1}`;
    });
    out.push(...list);
  }
  return out;
}

function mergeMapped(list: MappedRows[]): MappedRows {
  const concat = (sel: (m: MappedRows) => any[]) => list.flatMap(sel);
  const profilesMerged = list.map((m) => m.profiles[0]).filter(Boolean);
  return {
    profiles: profilesMerged.length ? [dedupRicher(profilesMerged, (p) => p.slug)[0]] : [],
    yearSettings: dedupRicher(concat((m) => m.yearSettings), (r) => `${r.year}`),
    clienti: dedupRicher(concat((m) => m.clienti), (r) => r.id),
    // Dedup per id (non per anno:progressivo): fatture distinte non vanno collassate
    // anche se condividono il progressivo. Stesso id su più file → longest-wins.
    fatture: renumberFattureByYear(dedupRicher(concat((m) => m.fatture), (r) => r.id)),
    pagamenti: dedupRicher(concat((m) => m.pagamenti), (r) => r.id),
    calendarEntries: dedupRicher(concat((m) => m.calendarEntries), (r) => `${r.year}:${r.month}:${r.day}`),
    budgetItems: dedupRicher(concat((m) => m.budgetItems), (r) => r.id),
    spese: dedupRicher(concat((m) => m.spese), (r) => r.id),
    dichiarazioni: dedupRicher(concat((m) => m.dichiarazioni), (r) => `${r.year}`),
  };
}
