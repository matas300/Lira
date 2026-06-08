# Slice 5A — Fatture core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Fatture core vertical slice — server CRUD `/api/fatture` scoped to profile, atomic gap-free numbering at *invia*, state machine (bozza→inviata→pagata + annulla-pagamento), shared pure validators, plus the `/fatture` page (table + filters + reusable-modal CRUD + inline "segna pagata" + 85k progress). TD01 only.

**Architecture:** Pure shared logic (`@shared/fattura-logic`) reused by Zod refines, route, and tests. Server route follows `routes/pagamenti.ts`/`routes/clienti.ts` (Hono, `requireSession`, scoped to `activeProfileId`, `toPublic` mapping, `db.transaction` for numbering). Numbering is assigned only on the bozza→inviata transition (drafts stay unnumbered; `progressivo`/`numero_display` are nullable, SQLite treats NULLs as distinct so the existing UNIQUE index holds). Frontend follows `pages/clienti.ts` on the existing `components/modal.ts`.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Hono, Drizzle (libSQL), Zod, Vite vanilla TS, Node `--test`.

**Reference patterns (read before starting):**
- `src/server/routes/pagamenti.ts` — route shape, `toPublic`, `todayIso`, PATCH/DELETE 404 scoping.
- `src/server/routes/clienti.ts` — `zJson` envelope, `isUniqueViolation`, `db.transaction` single-default.
- `src/server/routes/clienti.test.ts` — `makeApp()` harness with `createTestDb` + `createUserWithDefaultProfile` + `createSession`.
- `src/shared/schemas.ts` (end) — `applyClienteRefines`, `ClienteBase`, `ClientePublic` conventions.
- `src/client/pages/clienti.ts` — page mount/render/modal pattern, `esc()`, `readForm`.
- `CalcoliVari/fatture-state-machine.js` — `markPagata`/`markBozza` semantics to port.

**Conventions:** TS strict with `noUncheckedIndexedAccess` (always `arr[0]!` or guard). ESM. No global side-effects. Errors via `HttpError(status, code, message)` + existing `errorHandler`. Validation envelope `{ error: { code, message, details? } }` via `zJson` (from 4A).

**Test runner note:** `npm test` runs the whole suite. To run a single file: `node --import tsx --test src/path/to/file.test.ts`.

---

## Task 1: Schema migration — nullable progressivo + numero_display

Drafts have no number. Make the two numbering columns nullable; the existing UNIQUE index `(profile_id, anno_progressivo, progressivo)` is unchanged (SQLite NULLs are distinct). No production data exists, so the table-rebuild migration is safe.

**Files:**
- Modify: `src/server/db/schema.ts:124` and `:123`
- Generate: `drizzle/<nnnn>_*.sql` (via drizzle-kit)

- [ ] **Step 1: Edit the schema**

In `src/server/db/schema.ts`, inside `export const fatture`, change these two lines:

```ts
    progressivo: integer('progressivo').notNull(),
    numeroDisplay: text('numero_display').notNull(),
```

to:

```ts
    progressivo: integer('progressivo'),
    numeroDisplay: text('numero_display'),
```

Leave `annoProgressivo: integer('anno_progressivo').notNull()` unchanged (set from `year(data)` at create).

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` (e.g. `0007_*.sql`) that recreates `fatture` with the two columns nullable. drizzle-kit may prompt; accept defaults. Verify the generated SQL drops `NOT NULL` on `progressivo`/`numero_display` and preserves `fatture_progressivo_idx`.

- [ ] **Step 3: Verify migrations apply (typecheck + a clean test DB)**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: clean.
Run: `npm test -- src/server/routes/pagamenti.test.ts` (any existing route test re-runs `migrate()` against `./drizzle`).

> If `npm test -- <file>` doesn't filter on this project, run the explicit form: `node --import tsx --test src/server/routes/pagamenti.test.ts`.
Expected: PASS — proves the new migration applies cleanly on a fresh DB.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(fatture): progressivo + numero_display nullable (bozze senza numero)"
```

---

## Task 2: Shared pure logic — `@shared/fattura-logic.ts`

Pure functions, zero DOM/DB. Reused by Zod refines (Task 3), route (Task 4/5), and tests.

**Files:**
- Create: `src/shared/fattura-logic.ts`
- Test: `src/shared/fattura-logic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/fattura-logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRigaTotale,
  computeImporto,
  isBolloDovuto,
  validateRitenutaForfettario,
  validateClienteSnapshot,
  SOGLIA_BOLLO,
} from './fattura-logic';

test('computeRigaTotale — quantità × prezzo', () => {
  assert.equal(computeRigaTotale({ descrizione: 'x', quantita: 3, prezzoUnitario: 10 }), 30);
  assert.equal(computeRigaTotale({ descrizione: 'x', quantita: 1, prezzoUnitario: 0 }), 0);
});

test('computeImporto — somma righe, arrotondato a 2 decimali', () => {
  assert.equal(computeImporto([
    { descrizione: 'a', quantita: 2, prezzoUnitario: 10.005 },
    { descrizione: 'b', quantita: 1, prezzoUnitario: 5 },
  ]), 25.01);
  assert.equal(computeImporto([]), 0);
});

test('isBolloDovuto — forfettario e imponibile > 77,47 (strict)', () => {
  assert.equal(isBolloDovuto('forfettario', 77.47), false); // soglia esclusa
  assert.equal(isBolloDovuto('forfettario', 77.48), true);
  assert.equal(isBolloDovuto('forfettario', 1000), true);
  assert.equal(isBolloDovuto('ordinario', 1000), false); // bollo non in questo path
  assert.equal(SOGLIA_BOLLO, 77.47);
});

test('validateRitenutaForfettario — blocca ritenuta>0 in forfettario', () => {
  assert.equal(validateRitenutaForfettario('forfettario', 50) !== null, true);
  assert.equal(validateRitenutaForfettario('forfettario', 0), null);
  assert.equal(validateRitenutaForfettario('ordinario', 50), null);
});

test('validateClienteSnapshot — cliente IT senza P.IVA né CF → errore', () => {
  assert.equal(validateClienteSnapshot({ nazione: 'IT' }) !== null, true);
  assert.equal(validateClienteSnapshot({ nazione: 'IT', partitaIva: '00743110157' }), null);
  assert.equal(validateClienteSnapshot({ nazione: 'IT', codiceFiscale: 'RSSMRA80A01H501U' }), null);
  assert.equal(validateClienteSnapshot({ nazione: 'DE' }), null); // estero ok
  assert.equal(validateClienteSnapshot(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/fattura-logic.test.ts`
Expected: FAIL — `Cannot find module './fattura-logic'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/fattura-logic.ts
//
// Logica fiscale pura e riusabile per le fatture (Slice 5A). Nessuna
// dipendenza DOM/DB: usata dai refine Zod, dalla route e dai test.

import { isValidPartitaIvaIT, isValidCodiceFiscaleFormat } from './validators';

export interface RigaLike {
  descrizione?: string;
  quantita: number;
  prezzoUnitario: number;
}

export interface ClienteSnapshotLike {
  nazione?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
}

/** Soglia marca da bollo per operazioni esenti/non imponibili (art. 6 DM 17/06/2014). */
export const SOGLIA_BOLLO = 77.47;

export const MSG_RITENUTA_FORFETTARIO =
  "Il regime forfettario è esonerato dalla ritenuta d'acconto (art. 1 c. 67 L. 190/2014). " +
  'Rimuovere la ritenuta dalla fattura.';

export const MSG_CLIENTE_IT =
  'Cliente IT deve avere almeno la P.IVA o il Codice Fiscale (FatturaPA v1.2 §1.4.1.2).';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeRigaTotale(riga: RigaLike): number {
  const q = Number(riga.quantita) || 0;
  const p = Number(riga.prezzoUnitario) || 0;
  return round2(q * p);
}

export function computeImporto(righe: RigaLike[]): number {
  let sum = 0;
  for (const r of righe) sum += Number(r.quantita || 0) * Number(r.prezzoUnitario || 0);
  return round2(sum);
}

/** Bollo dovuto solo in regime forfettario quando l'imponibile esente supera 77,47 €. */
export function isBolloDovuto(regime: string, imponibileEsente: number): boolean {
  return regime === 'forfettario' && imponibileEsente > SOGLIA_BOLLO;
}

/** Ritorna messaggio errore o null. Forfettario + ritenuta>0 → vietato. */
export function validateRitenutaForfettario(regime: string, ritenuta: number): string | null {
  if (regime !== 'forfettario') return null;
  return Number(ritenuta) > 0 ? MSG_RITENUTA_FORFETTARIO : null;
}

/** Ritorna messaggio errore o null. Cliente IT senza P.IVA né CF → vietato. */
export function validateClienteSnapshot(snap: ClienteSnapshotLike | null | undefined): string | null {
  if (!snap) return null;
  const nazione = String(snap.nazione || 'IT').toUpperCase();
  if (nazione !== 'IT') return null;
  const piva = String(snap.partitaIva || '').replace(/\s+/g, '');
  const cf = String(snap.codiceFiscale || '').trim().toUpperCase();
  const hasPiva = piva.length > 0 && isValidPartitaIvaIT(piva);
  const hasCf = cf.length > 0 && isValidCodiceFiscaleFormat(cf);
  return hasPiva || hasCf ? null : MSG_CLIENTE_IT;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/fattura-logic.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/fattura-logic.ts src/shared/fattura-logic.test.ts
git commit -m "feat(fatture): logica pura (importo, bollo 77.47, ritenuta forfettario, cliente IT)"
```

---

## Task 3: Zod schemas + derived types

Extend `shared/schemas.ts` and `shared/types.ts`.

**Files:**
- Modify: `src/shared/schemas.ts` (append after the Clienti block)
- Modify: `src/shared/types.ts` (append derived types)
- Test: `src/shared/schemas.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/shared/schemas.test.ts`:

```ts
import { FatturaCreateInput, RigaSchema } from './schemas';

test('RigaSchema — quantità default 1, prezzo richiesto', () => {
  const r = RigaSchema.parse({ descrizione: 'Consulenza', prezzoUnitario: 100 });
  assert.equal(r.quantita, 1);
  assert.equal(r.prezzoUnitario, 100);
});

test('FatturaCreateInput — minimo valido (default TD01, ritenuta 0)', () => {
  const f = FatturaCreateInput.parse({
    clienteId: 'c1', data: '2026-03-01',
    righe: [{ descrizione: 'x', prezzoUnitario: 500 }],
  });
  assert.equal(f.tipoDocumento, 'TD01');
  assert.equal(f.ritenuta, 0);
  assert.equal(f.marcaDaBollo, false);
  assert.equal(f.righe[0]!.quantita, 1);
});

test('FatturaCreateInput — righe vuote → throw', () => {
  assert.throws(() => FatturaCreateInput.parse({ clienteId: 'c1', data: '2026-03-01', righe: [] }));
});

test('FatturaCreateInput — data non ISO → throw', () => {
  assert.throws(() => FatturaCreateInput.parse({
    clienteId: 'c1', data: '01/03/2026', righe: [{ descrizione: 'x', prezzoUnitario: 1 }],
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: FAIL — `FatturaCreateInput`/`RigaSchema` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/shared/schemas.ts` (after the Clienti block, end of file):

```ts
// ───── Fatture (Slice 5A) ─────

export const StatoFatturaEnum = z.enum(['bozza', 'inviata', 'pagata', 'stornata', 'annullata']);
export const TipoDocumentoEnum = z.enum(['TD01', 'TD04', 'TD24']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RigaSchema = z.object({
  descrizione: z.string().trim().min(1).max(1000),
  quantita: z.number().positive().default(1),
  prezzoUnitario: z.number(),
});

export const FatturaCreateInput = z.object({
  clienteId: z.string().min(1),
  tipoDocumento: TipoDocumentoEnum.default('TD01'),
  data: z.string().regex(ISO_DATE, 'Data attesa in formato YYYY-MM-DD'),
  righe: z.array(RigaSchema).min(1, 'Almeno una riga'),
  ritenuta: z.number().min(0).default(0),
  aliquotaRitenuta: z.number().optional().nullable(),
  tipoRitenuta: z.string().trim().optional().nullable(),
  causaleRitenuta: z.string().trim().optional().nullable(),
  contributoIntegrativo: z.number().min(0).default(0),
  marcaDaBollo: z.boolean().default(false),
  bolloAddebitato: z.boolean().default(false),
  modalitaPagamento: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

export const FatturaUpdateInput = FatturaCreateInput.partial();

const RigaPublic = z.object({
  descrizione: z.string(),
  quantita: z.number(),
  prezzoUnitario: z.number(),
});

export const FatturaPublic = z.object({
  id: z.string(),
  profileId: z.string(),
  clienteId: z.string().nullable(),
  tipoDocumento: TipoDocumentoEnum,
  annoProgressivo: z.number(),
  progressivo: z.number().nullable(),
  numeroDisplay: z.string().nullable(),
  data: z.string(),
  clienteSnapshot: z.record(z.unknown()).nullable(),
  righe: z.array(RigaPublic),
  importo: z.number(),
  ritenuta: z.number(),
  contributoIntegrativo: z.number(),
  marcaDaBollo: z.boolean(),
  bolloAddebitato: z.boolean(),
  stato: StatoFatturaEnum,
  dataInvioSdi: z.string().nullable(),
  dataPagamento: z.string().nullable(),
  pagMese: z.number().nullable(),
  pagAnno: z.number().nullable(),
  modalitaPagamento: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

Append to `src/shared/types.ts` — merge these names into the existing `import { ... } from './schemas'` block and add the type aliases:

```ts
import {
  StatoFatturaEnum as StatoFatturaEnumSchema,
  TipoDocumentoEnum as TipoDocumentoEnumSchema,
  RigaSchema as RigaSchemaSchema,
  FatturaCreateInput as FatturaCreateInputSchema,
  FatturaUpdateInput as FatturaUpdateInputSchema,
  FatturaPublic as FatturaPublicSchema,
} from './schemas';

export type StatoFattura = z.infer<typeof StatoFatturaEnumSchema>;
export type TipoDocumento = z.infer<typeof TipoDocumentoEnumSchema>;
export type Riga = z.infer<typeof RigaSchemaSchema>;
export type FatturaCreateInput = z.infer<typeof FatturaCreateInputSchema>;
export type FatturaUpdateInput = z.infer<typeof FatturaUpdateInputSchema>;
export type FatturaPublic = z.infer<typeof FatturaPublicSchema>;
```

> `types.ts` already imports `z` and other schema names — add the new import as a separate `import { ... } from './schemas'` statement (TS allows multiple) or merge into the existing one. Either is fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: PASS. Then `npx tsc -p tsconfig.json --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts src/shared/schemas.test.ts src/shared/types.ts
git commit -m "feat(fatture): Zod RigaSchema/FatturaCreate/Update/Public + tipi derivati"
```

---

## Task 4: Route `/api/fatture` — CRUD (no transitions yet)

Follows `routes/clienti.ts`. `toPublic` parses JSON columns and maps integer flags → booleans. Create makes a **bozza** (no number), computing `importo` and freezing a cliente snapshot from `clienteId`.

**Files:**
- Create: `src/server/routes/fatture.ts`
- Test: `src/server/routes/fatture.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — `Cannot find module './fatture'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/routes/fatture.ts
//
// CRUD anagrafica fatture (Slice 5A). Pattern routes/clienti.ts:
// requireSession, scoped a c.get('activeProfileId'), zJson per envelope.
//
// - Create → bozza senza numero (progressivo/numeroDisplay null).
// - importo computed da righe; cliente_snapshot congelato da clienteId.
// - PATCH fiscale consentito solo su bozza (inviata/pagata: solo note/modalita).
// - DELETE solo su bozza. Transizioni in Task 5.

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FatturaCreateInput, FatturaUpdateInput } from '@shared/schemas';
import { computeImporto } from '@shared/fattura-logic';
import { fatture, clienti } from '../db/schema';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { requireSession, type AuthEnv } from '../middleware/auth';

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
    data: row.data,
    clienteSnapshot: parseJson<Record<string, unknown> | null>(row.clienteSnapshot, null),
    righe: parseJson<Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>>(row.righe, []),
    importo: row.importo,
    ritenuta: row.ritenuta,
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
  db: AuthEnv['Variables']['db'], profileId: string, clienteId: string,
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
```

> **Type note:** the `db` param type `AuthEnv['Variables']['db']` in `buildClienteSnapshot` mirrors how the route obtains `db`. If `AuthEnv` doesn't expose `Variables` conveniently, type the param as `any` (consistent with `clearOtherDefaults(tx: any, …)` in `clienti.ts`) — the runtime path is covered by tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): route CRUD scoped + importo computed + snapshot cliente + PATCH/DELETE guard"
```

---

## Task 5: Transition endpoints — invia (numbering) / paga / annulla-pagamento

`/invia` assigns the next gap-free progressivo inside a transaction (retry once on UNIQUE), after fail-fast validation. `/paga` and `/annulla-pagamento` port the state machine.

**Files:**
- Modify: `src/server/routes/fatture.ts` (append handlers + imports)
- Test: `src/server/routes/fatture.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/server/routes/fatture.test.ts`:

```ts
import { yearSettings, fatture as fattureTable } from '../db/schema';
import { eq } from 'drizzle-orm';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — the `/invia` etc. routes return 404 (not defined).

- [ ] **Step 3: Write minimal implementation**

In `src/server/routes/fatture.ts`, extend the imports and append the handlers:

```ts
// add to existing imports:
import { yearSettings } from '../db/schema';
import { validateRitenutaForfettario, validateClienteSnapshot, isBolloDovuto } from '@shared/fattura-logic';
import { z as z2 } from 'zod';
```

```ts
function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
}

async function regimeFor(db: any, profileId: string, year: number): Promise<string> {
  const [ys] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year))).limit(1);
  return ys?.regime ?? 'forfettario';
}

// ─────────── POST /:id/invia ───────────
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
  const cliErr = validateClienteSnapshot(snapshot as any);
  if (cliErr) throw new HttpError(422, 'CLIENTE_INCOMPLETO', cliErr);

  // Bollo dovuto (forfettario, imponibile > 77,47 €) → marca da bollo sulla fattura.
  const bolloFlag = isBolloDovuto(regime, f.importo) ? 1 : f.marcaDaBollo;

  const iso = todayIso();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.transaction(async (tx: any) => {
        const rows = await tx.select({ p: fatture.progressivo }).from(fatture)
          .where(and(eq(fatture.profileId, profileId), eq(fatture.annoProgressivo, anno)));
        let max = 0;
        for (const r of rows) if (r.p != null && r.p > max) max = r.p;
        const next = max + 1;
        await tx.update(fatture).set({
          progressivo: next,
          numeroDisplay: `${anno}/${next}`,
          stato: 'inviata',
          dataInvioSdi: iso,
          marcaDaBollo: bolloFlag,
          updatedAt: new Date().toISOString(),
        }).where(and(eq(fatture.id, id), eq(fatture.profileId, profileId)));
      });
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt === 0) continue;
      throw err;
    }
  }

  const [row] = await db.select().from(fatture).where(eq(fatture.id, id)).limit(1);
  return c.json(toPublic(row!));
});

// ─────────── POST /:id/paga ───────────
const PagaInput = z2.object({ date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

fattureRoute.post('/:id/paga', zJson(PagaInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const { date } = c.req.valid('json') as z2.infer<typeof PagaInput>;

  const [f] = await db.select().from(fatture)
    .where(and(eq(fatture.id, id), eq(fatture.profileId, profileId))).limit(1);
  if (!f) throw new HttpError(404, 'FATTURA_NOT_FOUND', `Fattura ${id} non trovata`);
  if (f.stato !== 'inviata') throw new HttpError(409, 'FATTURA_NOT_PAGABILE', `Stato "${f.stato}" non pagabile`);

  const iso = date ?? todayIso();
  const [yy, mm] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
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
```

> The duplicate `z2` import alias avoids touching the existing top `import { z }`. If `z` is already imported, you may reuse it and skip `z2`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS (all 11 tests: 5 from Task 4 + 6 here).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): transizioni invia (numerazione atomica)/paga/annulla + validatori 422"
```

---

## Task 6: Mount route in server

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add import + mount**

In `src/server/index.ts`, add the import alongside the others (after the `clientiRoute` import):

```ts
import { fattureRoute } from './routes/fatture';
```

And the mount (after `app.route('/api/clienti', clientiRoute);`):

```ts
app.route('/api/fatture', fattureRoute);
```

- [ ] **Step 2: Verify the server typechecks and full suite is green**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: clean.
Run: `npm test`
Expected: all tests pass (221 existing + fattura-logic + schemas + fatture route).

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(fatture): mount /api/fatture"
```

---

## Task 7: Typed client `fatture-api.ts`

**Files:**
- Create: `src/client/lib/fatture-api.ts`

- [ ] **Step 1: Write the client**

```ts
// src/client/lib/fatture-api.ts
import { api } from './api';
import type { FatturaPublic, FatturaCreateInput, FatturaUpdateInput } from '@shared/types';

export function listFatture(stato?: string): Promise<FatturaPublic[]> {
  const q = stato ? `?stato=${encodeURIComponent(stato)}` : '';
  return api.get<FatturaPublic[]>(`/api/fatture${q}`);
}

export function getFattura(id: string): Promise<FatturaPublic> {
  return api.get<FatturaPublic>(`/api/fatture/${id}`);
}

export function createFattura(input: FatturaCreateInput): Promise<FatturaPublic> {
  return api.post<FatturaPublic>('/api/fatture', input);
}

export function updateFattura(id: string, input: FatturaUpdateInput): Promise<FatturaPublic> {
  return api.patch<FatturaPublic>(`/api/fatture/${id}`, input);
}

export function removeFattura(id: string): Promise<{ ok: true }> {
  return api.del<{ ok: true }>(`/api/fatture/${id}`);
}

export function inviaFattura(id: string): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${id}/invia`, {});
}

export function pagaFattura(id: string, date?: string): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${id}/paga`, date ? { date } : {});
}

export function annullaPagamento(id: string): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${id}/annulla-pagamento`, {});
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/fatture-api.ts
git commit -m "feat(client): fatture-api tipizzato (list/get/create/update/remove/invia/paga/annulla)"
```

---

## Task 8: Page `/fatture`

Pattern `pages/clienti.ts`. Table with filter chips, fatturato-vs-85k bar, row→modal CRUD, row actions (✉ invia / € paga inline / × delete bozza). Escape all user values.

**Files:**
- Create: `src/client/pages/fatture.ts`

- [ ] **Step 1: Write the page**

```ts
// src/client/pages/fatture.ts
import { getMe } from '../lib/auth';
import { ApiError } from '../lib/api';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';
import { openModal } from '../components/modal';
import { listClienti } from '../lib/clienti-api';
import {
  listFatture, createFattura, updateFattura, removeFattura,
  inviaFattura, pagaFattura,
} from '../lib/fatture-api';
import type { FatturaPublic, ClientePublic, Riga } from '@shared/types';

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
}

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clienteNome(f: FatturaPublic): string {
  const s = f.clienteSnapshot as { nome?: string } | null;
  return s?.nome ?? '—';
}

const FILTERS: Array<{ key: string; label: string; match: (f: FatturaPublic) => boolean }> = [
  { key: 'tutte', label: 'Tutte', match: () => true },
  { key: 'dapagare', label: 'Da pagare', match: (f) => f.stato === 'inviata' },
  { key: 'pagate', label: 'Pagate', match: (f) => f.stato === 'pagata' },
  { key: 'bozze', label: 'Bozze', match: (f) => f.stato === 'bozza' },
];

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;
  let fatture: FatturaPublic[] = [];
  let clienti: ClientePublic[] = [];
  let filterKey = 'tutte';

  function visible(): FatturaPublic[] {
    const f = FILTERS.find((x) => x.key === filterKey) ?? FILTERS[0]!;
    return fatture.filter(f.match);
  }

  function fatturatoAnnoCorrente(): number {
    const y = new Date().getUTCFullYear();
    return fatture
      .filter((f) => f.stato !== 'bozza' && f.annoProgressivo === y && f.tipoDocumento !== 'TD04')
      .reduce((s, f) => s + (f.importo || 0), 0);
  }

  function rowHtml(f: FatturaPublic): string {
    const num = f.numeroDisplay ?? '—';
    const stato = f.stato.toUpperCase();
    const azioni = f.stato === 'bozza'
      ? `<button class="btn btn-ghost" data-invia="${esc(f.id)}" title="Segna inviata">✉</button>
         <button class="btn btn-ghost" data-del="${esc(f.id)}" title="Elimina" style="color:var(--red);">✕</button>`
      : f.stato === 'inviata'
        ? `<button class="btn btn-ghost" data-paga="${esc(f.id)}" title="Segna pagata">€</button>`
        : '';
    return `
      <li data-id="${esc(f.id)}" class="fattura-row"
          style="display:grid;grid-template-columns:80px 1fr 90px 90px auto;gap:var(--space-2);align-items:center;
                 padding:var(--space-3);background:var(--bg);border-radius:var(--radius-md);">
        <span class="fattura-open" style="cursor:pointer;font-variant-numeric:tabular-nums;">${esc(num)}</span>
        <span class="fattura-open" style="cursor:pointer;"><strong>${esc(clienteNome(f))}</strong>
          <span style="color:var(--text-muted);"> ${esc(f.dataInvioSdi ?? f.data)}</span></span>
        <span style="text-align:right;">${eur(f.importo)}</span>
        <span style="color:var(--text-muted);">${esc(stato)}</span>
        <span style="display:flex;gap:var(--space-1);justify-content:flex-end;">${azioni}</span>
      </li>`;
  }

  function rigaInputs(r?: Partial<Riga>): string {
    return `
      <div class="riga-row" style="display:flex;gap:var(--space-2);align-items:flex-end;">
        <div class="form-row" style="flex:1;"><label>Descrizione</label>
          <input class="input" data-riga-desc value="${esc(r?.descrizione)}" /></div>
        <div class="form-row" style="flex:0 0 70px;"><label>Qtà</label>
          <input class="input" type="number" step="0.01" data-riga-qta value="${esc(r?.quantita ?? 1)}" /></div>
        <div class="form-row" style="flex:0 0 110px;"><label>Prezzo</label>
          <input class="input" type="number" step="0.01" data-riga-prezzo value="${esc(r?.prezzoUnitario ?? '')}" /></div>
        <button type="button" class="btn btn-ghost" data-riga-del style="color:var(--red);">✕</button>
      </div>`;
  }

  function formHtml(f?: FatturaPublic): string {
    const opts = clienti.map((c) => {
      const sel = f?.clienteId === c.id || (!f && c.isDefault) ? ' selected' : '';
      return `<option value="${esc(c.id)}"${sel}>${esc(c.nome)}</option>`;
    }).join('');
    const righe = (f?.righe && f.righe.length ? f.righe : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }]);
    const locked = !!f && f.stato !== 'bozza';
    return `
      <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${locked ? `<p style="color:var(--text-muted);">Fattura ${esc(f!.numeroDisplay ?? '')} ${esc(f!.stato)} — solo note modificabili.</p>` : ''}
        <div class="form-row"><label>Cliente *</label>
          <select class="input" data-cliente ${locked ? 'disabled' : ''}>${opts}</select></div>
        <div class="form-row"><label>Data *</label>
          <input class="input" type="date" data-data value="${esc(f?.data ?? new Date().toISOString().slice(0, 10))}" ${locked ? 'disabled' : ''} /></div>
        <div><label>Righe</label>
          <div data-righe style="display:flex;flex-direction:column;gap:var(--space-2);">${righe.map((r) => rigaInputs(r)).join('')}</div>
          ${locked ? '' : `<button type="button" class="btn btn-ghost" data-add-riga style="margin-top:var(--space-2);">+ Riga</button>`}</div>
        <div style="text-align:right;font-weight:600;">Totale: <span data-totale>—</span></div>
        <div class="form-row"><label>Note</label><input class="input" data-note value="${esc(f?.note)}" /></div>
        <p class="form-error" data-error hidden></p>
        <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
          <button type="submit" class="btn btn-primary">Salva</button>
          ${f && f.stato === 'bozza' ? `<button type="button" class="btn btn-ghost" data-delete style="color:var(--red);">Elimina</button>` : ''}
        </div>
      </form>`;
  }

  function readRighe(root: HTMLElement): Riga[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.riga-row')).map((row) => ({
      descrizione: (row.querySelector<HTMLInputElement>('[data-riga-desc]')!.value || '').trim(),
      quantita: Number(row.querySelector<HTMLInputElement>('[data-riga-qta]')!.value) || 0,
      prezzoUnitario: Number(row.querySelector<HTMLInputElement>('[data-riga-prezzo]')!.value) || 0,
    }));
  }

  function recalcTotale(root: HTMLElement): void {
    const tot = readRighe(root).reduce((s, r) => s + r.quantita * r.prezzoUnitario, 0);
    const el = root.querySelector<HTMLElement>('[data-totale]');
    if (el) el.textContent = eur(tot);
  }

  function openFatturaModal(existing?: FatturaPublic): void {
    openModal({
      title: existing ? (existing.numeroDisplay ?? 'Bozza') : 'Nuova fattura',
      bodyHtml: formHtml(existing),
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        const righeEl = root.querySelector<HTMLElement>('[data-righe]')!;
        const locked = !!existing && existing.stato !== 'bozza';

        const wireRigaRow = (row: HTMLElement) => {
          row.querySelector<HTMLButtonElement>('[data-riga-del]')?.addEventListener('click', () => {
            if (righeEl.querySelectorAll('.riga-row').length > 1) { row.remove(); recalcTotale(root); }
          });
          row.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.addEventListener('input', () => recalcTotale(root)));
        };
        righeEl.querySelectorAll<HTMLElement>('.riga-row').forEach(wireRigaRow);
        root.querySelector<HTMLButtonElement>('[data-add-riga]')?.addEventListener('click', () => {
          righeEl.insertAdjacentHTML('beforeend', rigaInputs());
          wireRigaRow(righeEl.lastElementChild as HTMLElement);
        });
        recalcTotale(root);

        root.querySelector<HTMLButtonElement>('[data-delete]')?.addEventListener('click', async () => {
          if (!existing || !confirm('Eliminare questa bozza?')) return;
          await removeFattura(existing.id); close(); await refresh();
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          try {
            if (locked) {
              await updateFattura(existing!.id, { note: root.querySelector<HTMLInputElement>('[data-note]')!.value.trim() || null });
            } else {
              const payload = {
                clienteId: root.querySelector<HTMLSelectElement>('[data-cliente]')!.value,
                data: root.querySelector<HTMLInputElement>('[data-data]')!.value,
                righe: readRighe(root),
                note: root.querySelector<HTMLInputElement>('[data-note]')!.value.trim() || null,
              };
              if (existing) await updateFattura(existing.id, payload as never);
              else await createFattura(payload as never);
            }
            close(); await refresh();
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Errore di salvataggio';
            errorEl.hidden = false;
          }
        });
      },
    });
  }

  function renderList(): void {
    const ul = container.querySelector<HTMLElement>('[data-list]');
    if (!ul) return;
    const rows = visible();
    ul.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : `<li style="color:var(--text-muted);padding:var(--space-3);">Nessuna fattura.</li>`;
    ul.querySelectorAll<HTMLElement>('.fattura-open').forEach((el) => {
      el.addEventListener('click', () => {
        const li = el.closest<HTMLElement>('.fattura-row')!;
        const f = fatture.find((x) => x.id === li.dataset.id);
        if (f) openFatturaModal(f);
      });
    });
    ul.querySelectorAll<HTMLButtonElement>('[data-invia]').forEach((b) => b.addEventListener('click', async () => {
      try { await inviaFattura(b.dataset.invia!); await refresh(); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore invio'); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-paga]').forEach((b) => b.addEventListener('click', async () => {
      const d = prompt('Data incasso (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
      if (!d) return;
      try { await pagaFattura(b.dataset.paga!, d); await refresh(); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore'); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Eliminare questa bozza?')) return;
      try { await removeFattura(b.dataset.del!); await refresh(); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore'); }
    }));
  }

  function renderMeta(): void {
    const bar = container.querySelector<HTMLElement>('[data-fatturato]');
    if (!bar) return;
    const tot = fatturatoAnnoCorrente();
    const pct = Math.min(100, Math.round((tot / 85000) * 100));
    bar.innerHTML = `Fatturato ${new Date().getUTCFullYear()}: ${eur(tot)} / €85.000
      <div style="height:6px;background:var(--bg);border-radius:4px;margin-top:4px;">
        <div style="height:100%;width:${pct}%;background:var(--mint);border-radius:4px;"></div></div>`;
  }

  async function refresh(): Promise<void> {
    fatture = await listFatture();
    renderList(); renderMeta();
  }

  async function render(): Promise<void> {
    const me = await getMe();
    if (!me) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    clienti = await listClienti();
    const chips = FILTERS.map((f) =>
      `<button class="btn btn-ghost" data-filter="${f.key}">${f.label}</button>`).join('');
    container.innerHTML = `
      <div class="app-shell">
        ${renderHeader(me, render)}
        <main class="app-main">
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
              <h2 style="margin:0;">Fatture</h2>
              <button class="btn btn-primary" data-new${clienti.length ? '' : ' disabled title="Crea prima un cliente"'}>Nuova</button>
            </div>
            <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3);">${chips}</div>
            <div data-fatturato style="margin-bottom:var(--space-4);color:var(--text-muted);"></div>
            <ul data-list style="list-style:none;display:flex;flex-direction:column;gap:var(--space-2);"></ul>
          </div>
        </main>
        ${renderBottomNav()}
      </div>`;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);

    container.querySelector<HTMLButtonElement>('[data-new]')?.addEventListener('click', () => openFatturaModal());
    container.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      filterKey = b.dataset.filter!; renderList();
    }));
    await refresh();
  }

  render();
  return () => { if (cleanupHeader) cleanupHeader(); };
}
```

> **CSS-token note:** if `var(--red)`/`var(--mint)` aren't defined in `tokens.css`, swap for the nearest existing token (check `src/client/styles/tokens.css`); the `clienti.ts` page already uses `var(--red)`, so it exists.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean. (`payload as never` sidesteps Zod-input vs plain-object typing; the server re-validates.)

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/fatture.ts
git commit -m "feat(client): pagina /fatture (tabella+filtri+modal CRUD+invia/paga inline+barra 85k)"
```

---

## Task 9: Navigation — enable Fatture tab + route

**Files:**
- Modify: `src/client/components/bottom-nav.ts`
- Modify: `src/client/main.ts`

- [ ] **Step 1: Enable the nav entry**

In `src/client/components/bottom-nav.ts`, change the Fatture tab from disabled to a real route. Replace:

```ts
      <a class="tab" aria-disabled="true">📄 Fatture</a>
```

with:

```ts
      <a class="tab" data-route="/fatture" href="/fatture">📄 Fatture</a>
```

- [ ] **Step 2: Register the route**

In `src/client/main.ts`, add to the `routes` record (after the `/clienti` entry):

```ts
  // @ts-ignore — pages/fatture.ts created in Slice 5A
  '/fatture': () => import('./pages/fatture'),
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: typecheck clean; Vite build succeeds (a `fatture-*.js` chunk appears).

- [ ] **Step 4: Commit**

```bash
git add src/client/components/bottom-nav.ts src/client/main.ts
git commit -m "feat(client): voce nav Fatture + route /fatture"
```

---

## Task 10: Smoke test (Playwright) extension

Extend `scripts/smoke-playwright.mjs`: login → open `/fatture` → create bozza → invia (gets number) → segna pagata. **First read the existing script** to match its login/setup helpers and assertion style; it must seed a cliente first (the modal needs one).

**Files:**
- Modify: `scripts/smoke-playwright.mjs`

- [ ] **Step 1: Read the existing smoke script**

Open `scripts/smoke-playwright.mjs`; identify how it logs in, the `BASE` URL, and where the Clienti scenario ends (Slice 4A appended one). The Fatture scenario must run **after** a cliente exists — reuse the cliente created by the Clienti scenario, or create one inline.

- [ ] **Step 2: Append the Fatture scenario**

Add, in the existing script's style (adapt selectors to actual conventions):

```js
// --- Fatture smoke (Slice 5A) ---
await page.goto(`${BASE}/fatture`);
await page.click('[data-new]');
await page.fill('[data-riga-desc]', 'Consulenza smoke');
await page.fill('[data-riga-prezzo]', '1000');
await page.click('[data-form] button[type="submit"]');
await page.waitForSelector('text=Consulenza smoke, .fattura-row');
console.log('✓ bozza fattura creata');

// invia → ottiene numero
await page.click('[data-invia]');
await page.waitForSelector('text=/\\d{4}\\/\\d+/');
console.log('✓ fattura inviata con numero');

// segna pagata (prompt date → accetta default)
page.once('dialog', (d) => d.accept());
await page.click('[data-paga]');
await page.waitForSelector('text=PAGATA');
console.log('✓ fattura segnata pagata');
```

> The `[data-paga]` handler uses `prompt()`; Playwright's `dialog` event must be accepted (the `page.once('dialog', …)` line). If the existing script disallows native dialogs, adapt to whatever inline picker the page exposes.

- [ ] **Step 3: Run the smoke test**

Run: the project's smoke command (check `package.json` / the script header — likely `node scripts/smoke-playwright.mjs` with the dev server up).
Expected: the three new `✓` lines print; script exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-playwright.mjs
git commit -m "test(fatture): smoke Playwright crea bozza + invia + paga"
```

---

## Task 11: Docs + final verification

**Files:**
- Modify: `docs/migration-plan.md` (tick the relevant Fase 5 items)
- Verify: `docs/data-model.md` (annotate nullability, no structural change)

- [ ] **Step 1: Update migration-plan**

In `docs/migration-plan.md`, under **Fase 5 — Fatture**, mark the items delivered by 5A. Replace:

```markdown
- [ ] Wizard 3-step creazione
- [ ] Storico fatture (tabella, filtri, stato)
- [ ] State machine bozza → inviata → pagata; ortogonale NC TD04 → stornata
```

with:

```markdown
- [x] Creazione fattura via modal (TD01) + numerazione atomica all'invio (Slice 5A, 2026-06-07)
- [x] Storico fatture (tabella, filtri, stato) + pagina `/fatture` (Slice 5A, 2026-06-07)
- [x] State machine bozza → inviata → pagata (+ annulla-pagamento); NC TD04 → stornata rinviata a 5B (Slice 5A, 2026-06-07)
```

Leave the XML / PDF / validators-XML / import items unchecked (5B–5D).

- [ ] **Step 2: Annotate data-model (nullability only)**

In `docs/data-model.md`, in the `fatture` table, update the notes for `progressivo` and `numero_display` to read `nullable (assegnato all'invio; bozze senza numero)`. No structural change.

- [ ] **Step 3: Full suite + typechecks + build, all green**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.server.json --noEmit && npm run build`
Expected: all tests pass (221 existing + new fattura-logic/schemas/fatture-route), both typechecks clean, build succeeds. Capture the new total test count.

- [ ] **Step 4: Commit**

```bash
git add docs/migration-plan.md docs/data-model.md
git commit -m "docs: Fase 5 Fatture core completata (Slice 5A)"
```

- [ ] **Step 5: Definition of Done check** (from spec §9)

Confirm each: migration nullable applied ✓; CRUD scoped + importo computed + snapshot ✓; numerazione atomica gap-free ✓; state machine + 409 on illegal transitions ✓; server validators (ritenuta forfettario, cliente IT, bollo) ✓; `/fatture` page (table+filters+modal+inline paga+85k bar) ✓; nav + route + smoke ✓; suite/typecheck/build green ✓.

---

## Notes for the executor

- **Run from repo root** (`C:\Users\matti\Documents\Progetti\Lira\Lira`). Shell PowerShell; npm/npx commands are shell-agnostic. Single-file test: `node --import tsx --test <file>`.
- **`noUncheckedIndexedAccess`:** always `arr[0]!` or guard after index/`.find()`. The provided code already does this.
- **No new dependencies.** Everything uses Hono, Drizzle, Zod, DOM APIs already present.
- **Regime default:** `/invia` reads `year_settings(profileId, year(data))`; absent → `'forfettario'`. This makes the ritenuta-block the safe default and keeps tests seed-free.
- **Numbering invariant:** progressivo is assigned ONLY in `/invia`, inside a `db.transaction` with one UNIQUE-violation retry. Never assign at create/PATCH.
- **Niente legacy carry-over:** the monthly `data.fatture[m]` model from CalcoliVari is NOT ported (data-model "Cosa NON c'è"); the `fatture` table is the single source of truth.
