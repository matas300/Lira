# Foundation Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare lo slice Foundation di Lira (Fase 1+2 del migration plan): schema DB completo, server Hono con auth a sessioni su DB, CLI per gestire utenti e profili, frontend shell con dark theme portato da CalcoliVari. Zero feature fiscali.

**Architecture:** Vite (TS vanilla) per il client → proxy `/api` → Hono server (Node 22) → Drizzle ORM → libSQL (file locale in dev, Turso in prod). Cookie sessions HTTP-only memorizzate in tabella `sessions`. Multi-profilo: 1 user → N profiles, switch via `active_profile_id` sulla session row. Registrazione disabilitata: utenti creati solo via script CLI.

**Tech Stack:** TypeScript 5.7 strict, Hono 4, Drizzle 0.36, @libsql/client 0.14, @node-rs/argon2 (rimpiazza `argon2` per compatibilità Windows), Zod 3, Vite 6, Node 22.

**Riferimenti:**
- Spec: `docs/superpowers/specs/2026-05-25-foundation-slice-design.md`
- Data model: `docs/data-model.md`
- Architettura: `docs/architecture.md`
- Codebase legacy da cui portare CSS tokens: `C:\Users\matti\Documents\Progetti\Lira\CalcoliVari\style.css`

**Convenzioni:**
- Tutto ESM (`"type": "module"`).
- Path alias: `@shared/*`, `@server/*`, `@client/*`.
- `noUncheckedIndexedAccess` on → ogni accesso array/record è `T | undefined`.
- Test: `node --test --import tsx <dir>` (Node 22 scopre `*.test.ts` ricorsivamente).
- Commit dopo ogni task (anche dopo le sotto-parti dei task grandi).

---

## Task 1: Allineare config + dipendenze

**Files:**
- Modify: `package.json` (script test, dipendenza argon2, nuovi script CLI)
- Modify: `.env.example` (semplificare per Foundation)
- Modify: `drizzle.config.ts` (aggiungere dialect `sqlite` fallback per dev locale)
- Create: `src/server/.gitkeep`, `src/client/.gitkeep`, `src/shared/.gitkeep`, `scripts/.gitkeep` (non servono se i veri file arrivano dopo, ma piattaforma di lavoro)

- [ ] **Step 1: Sostituire `argon2` con `@node-rs/argon2` in package.json**

`@node-rs/argon2` ha prebuilt binaries per Windows/Mac/Linux → niente toolchain C++ richiesta. API: `hash(plain)`, `verify(hash, plain)` (ordine inverso da `argon2` ufficiale).

Modifica `package.json`:

```json
{
  "name": "lira",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Lira — Partita IVA fullstack (successor of CalcoliVari)",
  "scripts": {
    "dev": "concurrently -k -n server,web -c blue,magenta \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "tsx watch --env-file=.env src/server/index.ts",
    "dev:web": "vite",
    "build": "npm run build:web && npm run build:server",
    "build:web": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "start": "node --env-file=.env dist/server/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx --env-file=.env src/server/db/migrate.ts",
    "db:studio": "drizzle-kit studio",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src",
    "lint": "echo 'no linter configured'",
    "create-user": "tsx --env-file=.env scripts/create-user.ts",
    "reset-password": "tsx --env-file=.env scripts/reset-password.ts",
    "create-profile": "tsx --env-file=.env scripts/create-profile.ts",
    "import:legacy": "tsx --env-file=.env scripts/import-from-calcolivari.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@hono/zod-validator": "^0.4.1",
    "@libsql/client": "^0.14.0",
    "@node-rs/argon2": "^2.0.2",
    "drizzle-orm": "^0.36.4",
    "hono": "^4.6.12",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "concurrently": "^9.1.0",
    "drizzle-kit": "^0.28.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vite": "^6.0.3"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Aggiornare `.env.example`**

```
# ────────────────────────────────────────────────────────────────────────────
# Lira — variabili d'ambiente
# Copia in .env e compila. Non committare .env.
# ────────────────────────────────────────────────────────────────────────────

# Server
NODE_ENV=development
PORT=8787

# Database
# Dev locale: file:./local.db (default, niente Turso necessario)
# Prod / staging: libsql://lira-prod-<org>.turso.io
DATABASE_URL=file:./local.db
DATABASE_AUTH_TOKEN=

# OpenAPI (autofill cliente da P.IVA — ereditato da CalcoliVari, NON usato in Foundation)
OPENAPI_KEY=
```

- [ ] **Step 3: Verificare `drizzle.config.ts`**

È già OK: `dialect: 'turso'` funziona anche con `file:./local.db` (libSQL client gestisce entrambi gli URL transparently). Nessuna modifica necessaria. Verificare leggendo il file.

- [ ] **Step 4: Installare le dipendenze aggiornate**

Run: `npm install`
Expected: nessun errore di build native (argon2 nativo Windows era il rischio; `@node-rs/argon2` ha prebuilt).

- [ ] **Step 5: Smoke typecheck**

Run: `npm run typecheck`
Expected: PASS (niente file in `src/` ancora, ma tsc legge `include` e non si lamenta).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: dipendenze e script Foundation (argon2→@node-rs/argon2, CLI scripts)"
```

---

## Task 2: Schema DB completo (Drizzle)

**Files:**
- Create: `src/server/db/schema.ts`

- [ ] **Step 1: Scrivere lo schema completo con tutte le 11 tabelle**

File: `src/server/db/schema.ts`

```ts
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ──────────────────────────── users ────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ──────────────────────────── sessions ────────────────────────────
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    activeProfileId: text('active_profile_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    lastUsedAt: text('last_used_at').notNull().default(nowIso),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

// ──────────────────────────── profiles ────────────────────────────
export const profiles = sqliteTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    anagrafica: text('anagrafica'), // JSON
    attivita: text('attivita'), // JSON
    giorniIncasso: integer('giorni_incasso').notNull().default(30),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    userSlugIdx: uniqueIndex('profiles_user_slug_idx').on(t.userId, t.slug),
  }),
);

// ──────────────────────────── year_settings ────────────────────────────
export const yearSettings = sqliteTable(
  'year_settings',
  {
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    regime: text('regime').notNull(),
    coefficiente: real('coefficiente').notNull(),
    impostaSostitutiva: real('imposta_sostitutiva').notNull(),
    inpsMode: text('inps_mode').notNull(),
    inpsCategoria: text('inps_categoria'),
    riduzione35: integer('riduzione_35').notNull().default(0),
    haRedditoDipendente: integer('ha_reddito_dipendente').notNull().default(0),
    limiteForfettario: integer('limite_forfettario').notNull().default(85000),
    scadenziarioMetodo: text('scadenziario_metodo').notNull().default('storico'),
    primoAnnoFatturatoPrec: real('primo_anno_fatturato_prec'),
    primoAnnoImpostaPrec: real('primo_anno_imposta_prec'),
    primoAnnoAccontiImpostaPrec: real('primo_anno_acconti_imposta_prec'),
    primoAnnoContribVariabiliPrec: real('primo_anno_contrib_variabili_prec'),
    primoAnnoAccontiContribPrec: real('primo_anno_acconti_contrib_prec'),
    overrides: text('overrides'), // JSON
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.year] }),
  }),
);

// ──────────────────────────── clienti ────────────────────────────
export const clienti = sqliteTable(
  'clienti',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    tipoCliente: text('tipo_cliente').notNull().default('PG'),
    partitaIva: text('partita_iva'),
    codiceFiscale: text('codice_fiscale'),
    codiceSdi: text('codice_sdi'),
    pec: text('pec'),
    indirizzo: text('indirizzo'),
    cap: text('cap'),
    citta: text('citta'),
    provincia: text('provincia'),
    nazione: text('nazione').notNull().default('IT'),
    descrizioneStandard: text('descrizione_standard'),
    isDefault: integer('is_default').notNull().default(0),
    note: text('note'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    profilePivaIdx: uniqueIndex('clienti_profile_piva_idx').on(t.profileId, t.partitaIva),
    profileCfIdx: uniqueIndex('clienti_profile_cf_idx').on(t.profileId, t.codiceFiscale),
  }),
);

// ──────────────────────────── fatture ────────────────────────────
export const fatture = sqliteTable(
  'fatture',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    clienteId: text('cliente_id').references(() => clienti.id, { onDelete: 'set null' }),
    tipoDocumento: text('tipo_documento').notNull().default('TD01'),
    annoProgressivo: integer('anno_progressivo').notNull(),
    progressivo: integer('progressivo').notNull(),
    numeroDisplay: text('numero_display').notNull(),
    data: text('data').notNull(),
    clienteSnapshot: text('cliente_snapshot'), // JSON
    righe: text('righe').notNull(), // JSON
    importo: real('importo').notNull(),
    ritenuta: real('ritenuta').notNull().default(0),
    aliquotaRitenuta: real('aliquota_ritenuta'),
    tipoRitenuta: text('tipo_ritenuta'),
    causaleRitenuta: text('causale_ritenuta'),
    contributoIntegrativo: real('contributo_integrativo').notNull().default(0),
    marcaDaBollo: integer('marca_da_bollo').notNull().default(0),
    bolloAddebitato: integer('bollo_addebitato').notNull().default(0),
    stato: text('stato').notNull().default('bozza'),
    dataInvioSdi: text('data_invio_sdi'),
    dataPagamento: text('data_pagamento'),
    pagMese: integer('pag_mese'),
    pagAnno: integer('pag_anno'),
    modalitaPagamento: text('modalita_pagamento'),
    fatturaOriginaleId: text('fattura_originale_id'),
    tipoStorno: text('tipo_storno'),
    ncTotaleImporto: real('nc_totale_importo').notNull().default(0),
    ncIds: text('nc_ids'), // JSON
    origine: text('origine').notNull().default('manuale'),
    note: text('note'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    progressivoIdx: uniqueIndex('fatture_progressivo_idx').on(t.profileId, t.annoProgressivo, t.progressivo),
    pagAnnoMeseIdx: index('fatture_pag_anno_mese_idx').on(t.profileId, t.pagAnno, t.pagMese),
    statoIdx: index('fatture_stato_idx').on(t.profileId, t.stato),
  }),
);

// ──────────────────────────── pagamenti ────────────────────────────
export const pagamenti = sqliteTable(
  'pagamenti',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    data: text('data').notNull(),
    tipo: text('tipo').notNull(),
    descrizione: text('descrizione'),
    importo: real('importo').notNull(),
    scheduleKey: text('schedule_key'),
    linkedKeys: text('linked_keys'), // JSON
    note: text('note'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    profileYearIdx: index('pagamenti_profile_year_idx').on(t.profileId, t.year),
    scheduleKeyIdx: index('pagamenti_schedule_key_idx').on(t.profileId, t.scheduleKey),
  }),
);

// ──────────────────────────── calendar_entries ────────────────────────────
export const calendarEntries = sqliteTable(
  'calendar_entries',
  {
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    day: integer('day').notNull(),
    activityCode: text('activity_code').notNull(),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.year, t.month, t.day] }),
  }),
);

// ──────────────────────────── budget_items ────────────────────────────
export const budgetItems = sqliteTable('budget_items', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nome: text('nome').notNull(),
  importo: real('importo').notNull(),
  auto: integer('auto').notNull().default(0),
  ordine: integer('ordine').notNull().default(0),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ──────────────────────────── spese ────────────────────────────
export const spese = sqliteTable('spese', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  titolo: text('titolo').notNull(),
  costo: real('costo').notNull(),
  deducibilita: real('deducibilita').notNull(),
  anni: integer('anni').notNull().default(1),
  categoria: text('categoria'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ──────────────────────────── dichiarazioni ────────────────────────────
export const dichiarazioni = sqliteTable(
  'dichiarazioni',
  {
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    tipo: text('tipo').notNull().default('ordinaria'),
    flags: text('flags'), // JSON
    contiEsteri: text('conti_esteri'), // JSON
    overrides: text('overrides'), // JSON
    statoCompilazione: text('stato_compilazione'), // JSON
    confirmedWarnings: text('confirmed_warnings'), // JSON
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.year] }),
  }),
);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema.ts
git commit -m "feat(db): schema completo data-model (11 tabelle Drizzle)"
```

---

## Task 3: Generare baseline migration

**Files:**
- Create: `drizzle/0000_<auto>.sql` (generato)
- Create: `drizzle/meta/_journal.json` (generato)

- [ ] **Step 1: Generare la migration**

Run: `npm run db:generate`
Expected: stampa "0 changes" → no, dovrebbe generare un file `drizzle/0000_<random_name>.sql` con tutte le CREATE TABLE.

- [ ] **Step 2: Ispezionare il file SQL generato**

Apri `drizzle/0000_<...>.sql`. Verifica che contenga `CREATE TABLE users`, `sessions`, `profiles`, `year_settings`, `clienti`, `fatture`, `pagamenti`, `calendar_entries`, `budget_items`, `spese`, `dichiarazioni`, più tutti gli indici elencati nello schema.

Se per qualche motivo manca un indice o una FK, fixare lo schema (Task 2) e ri-generare.

- [ ] **Step 3: Commit**

```bash
git add drizzle/
git commit -m "feat(db): baseline migration 0000 (tutte le tabelle)"
```

---

## Task 4: DB client + migrate runner + test helper

**Files:**
- Create: `src/server/db/client.ts`
- Create: `src/server/db/migrate.ts`
- Create: `src/server/db/test-helper.ts`
- Create: `src/server/db/migrate.test.ts`

- [ ] **Step 1: Scrivere `client.ts`**

```ts
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(url: string, authToken?: string): { db: Db; client: Client } {
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { db, client };
}

let cached: { db: Db; client: Client } | undefined;

export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL ?? 'file:./local.db';
    const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
    cached = createDb(url, authToken);
  }
  return cached.db;
}
```

- [ ] **Step 2: Scrivere `migrate.ts`**

```ts
import { migrate } from 'drizzle-orm/libsql/migrator';
import { getDb } from './client';

async function main() {
  const db = getDb();
  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Scrivere il test helper**

```ts
// src/server/db/test-helper.ts
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, type Db } from './client';
import type { Client } from '@libsql/client';

export async function createTestDb(): Promise<{ db: Db; client: Client }> {
  // file::memory:?cache=shared è importante perché ogni connection diversa vede lo stesso DB
  // Ma per test isolati basta `:memory:`
  const { db, client } = createDb(':memory:');
  await migrate(db, { migrationsFolder: './drizzle' });
  return { db, client };
}
```

- [ ] **Step 4: Scrivere test per migrations**

```ts
// src/server/db/migrate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-helper';

test('migrations creano tutte le tabelle attese', async () => {
  const { client } = await createTestDb();
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  const tables = result.rows.map((r) => r.name as string);
  for (const expected of [
    'budget_items',
    'calendar_entries',
    'clienti',
    'dichiarazioni',
    'fatture',
    'pagamenti',
    'profiles',
    'sessions',
    'spese',
    'users',
    'year_settings',
  ]) {
    assert.ok(tables.includes(expected), `Manca tabella: ${expected}`);
  }
});

test('users ha colonne email UNIQUE', async () => {
  const { client } = await createTestDb();
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
    args: ['u1', 'a@b.it', 'hash', 'A'],
  });
  await assert.rejects(
    () => client.execute({
      sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
      args: ['u2', 'a@b.it', 'hash', 'B'],
    }),
    /UNIQUE/,
  );
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 2 test PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/
git commit -m "feat(db): client libSQL, migrate runner, test helper"
```

---

## Task 5: `password.ts` (TDD strict)

**Files:**
- Create: `src/server/lib/password.test.ts`
- Create: `src/server/lib/password.ts`

- [ ] **Step 1: Scrivere il test (FAIL atteso)**

```ts
// src/server/lib/password.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password';

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
});

test('verifyPassword ritorna false con password sbagliata', async () => {
  const hash = await hashPassword('right');
  assert.equal(await verifyPassword(hash, 'wrong'), false);
});

test('verifyPassword ritorna false con hash malformato', async () => {
  assert.equal(await verifyPassword('not-a-hash', 'qualsiasi'), false);
});
```

- [ ] **Step 2: Run test → FAIL atteso**

Run: `npm test`
Expected: FAIL (modulo `./password` non esiste).

- [ ] **Step 3: Implementare `password.ts`**

```ts
// src/server/lib/password.ts
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, {
    // memoryCost in KiB. 64 MiB è il default sicuro raccomandato OWASP.
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm test`
Expected: 3 test PASS (anche i precedenti restano verdi).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/password.ts src/server/lib/password.test.ts
git commit -m "feat(auth): password hashing con argon2id"
```

---

## Task 6: `session.ts` (TDD strict)

**Files:**
- Create: `src/server/lib/session.test.ts`
- Create: `src/server/lib/session.ts`

- [ ] **Step 1: Scrivere i test**

```ts
// src/server/lib/session.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../db/test-helper';
import { createSession, getSession, refreshSession, deleteSession, deleteAllSessionsForUser } from './session';

async function seedUser(client: import('@libsql/client').Client) {
  const userId = randomUUID();
  const profileId = randomUUID();
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
    args: [userId, 'x@y.it', 'h', 'X'],
  });
  await client.execute({
    sql: `INSERT INTO profiles (id, user_id, slug, display_name) VALUES (?, ?, ?, ?)`,
    args: [profileId, userId, 'default', 'X'],
  });
  return { userId, profileId };
}

test('createSession crea row e ritorna id + expiresAt 30gg', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const session = await createSession(db, userId, profileId);
  assert.match(session.id, /^[0-9a-f-]{36}$/);
  const expiresAt = new Date(session.expiresAt).getTime();
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(expiresAt - (now + thirtyDays)) < 5_000);
});

test('getSession ritorna la session se esiste e non scaduta', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const created = await createSession(db, userId, profileId);
  const fetched = await getSession(db, created.id);
  assert.ok(fetched);
  assert.equal(fetched.userId, userId);
  assert.equal(fetched.activeProfileId, profileId);
});

test('getSession ritorna null se scaduta e cancella la riga', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const created = await createSession(db, userId, profileId);
  // force expire
  await client.execute({
    sql: `UPDATE sessions SET expires_at = ? WHERE id = ?`,
    args: ['2000-01-01T00:00:00.000Z', created.id],
  });
  const fetched = await getSession(db, created.id);
  assert.equal(fetched, null);
  // cleanup
  const count = await client.execute({
    sql: `SELECT count(*) as c FROM sessions WHERE id = ?`,
    args: [created.id],
  });
  assert.equal((count.rows[0] as any).c, 0);
});

test('refreshSession aggiorna lastUsedAt e estende expiresAt', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const created = await createSession(db, userId, profileId);
  // forza un valore vecchio
  await client.execute({
    sql: `UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?`,
    args: ['2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z', created.id],
  });
  await refreshSession(db, created.id);
  const after = await getSession(db, created.id);
  assert.ok(after);
  assert.ok(new Date(after.lastUsedAt).getTime() > new Date('2025-12-31').getTime());
  assert.ok(new Date(after.expiresAt).getTime() > Date.now());
});

test('deleteSession rimuove la riga', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const s = await createSession(db, userId, profileId);
  await deleteSession(db, s.id);
  const fetched = await getSession(db, s.id);
  assert.equal(fetched, null);
});

test('deleteAllSessionsForUser rimuove tutte le sessions dell utente', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  await createSession(db, userId, profileId);
  await createSession(db, userId, profileId);
  await deleteAllSessionsForUser(db, userId);
  const r = await client.execute({
    sql: `SELECT count(*) as c FROM sessions WHERE user_id = ?`,
    args: [userId],
  });
  assert.equal((r.rows[0] as any).c, 0);
});
```

- [ ] **Step 2: Run → FAIL atteso**

Run: `npm test`
Expected: FAIL (modulo `./session` non esiste).

- [ ] **Step 3: Implementare `session.ts`**

```ts
// src/server/lib/session.ts
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionRow = typeof sessions.$inferSelect;

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function isoNow(): string {
  return new Date().toISOString();
}

export async function createSession(db: Db, userId: string, activeProfileId: string): Promise<SessionRow> {
  const row: SessionRow = {
    id: randomUUID(),
    userId,
    activeProfileId,
    expiresAt: isoIn(SESSION_TTL_MS),
    createdAt: isoNow(),
    lastUsedAt: isoNow(),
  };
  await db.insert(sessions).values(row);
  return row;
}

export async function getSession(db: Db, id: string): Promise<SessionRow | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return row;
}

export async function refreshSession(db: Db, id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastUsedAt: isoNow(), expiresAt: isoIn(SESSION_TTL_MS) })
    .where(eq(sessions.id, id));
}

export async function setActiveProfile(db: Db, id: string, profileId: string): Promise<void> {
  await db.update(sessions).set({ activeProfileId: profileId }).where(eq(sessions.id, id));
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
```

- [ ] **Step 4: Run → PASS**

Run: `npm test`
Expected: tutti i test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/session.ts src/server/lib/session.test.ts
git commit -m "feat(auth): session store con TTL 30gg rolling"
```

---

## Task 7: Zod schemas condivisi

**Files:**
- Create: `src/shared/schemas.ts`
- Create: `src/shared/types.ts`

- [ ] **Step 1: Scrivere gli schemas**

```ts
// src/shared/schemas.ts
import { z } from 'zod';

// ───── Auth ─────
export const LoginInput = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  password: z.string().min(8).max(200),
});

export const UserPublic = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

export const ProfilePublic = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  giorniIncasso: z.number(),
});

export const MeResponse = z.object({
  user: UserPublic,
  profiles: z.array(ProfilePublic),
  activeProfile: ProfilePublic,
});

export const LoginResponse = MeResponse;

// ───── Profiles ─────
export const ProfileCreateInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'slug: solo lowercase alfanum e trattini'),
  displayName: z.string().min(1).max(100),
});

// ───── Error envelope ─────
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const OkEnvelope = z.object({ ok: z.literal(true) });

export const HealthResponse = z.object({
  ok: z.literal(true),
  version: z.string(),
});
```

```ts
// src/shared/types.ts
import type { z } from 'zod';
import type {
  LoginInput,
  LoginResponse,
  MeResponse,
  UserPublic,
  ProfilePublic,
  ProfileCreateInput,
  ErrorEnvelope,
  HealthResponse,
} from './schemas';

export type LoginInput = z.infer<typeof LoginInput>;
export type LoginResponse = z.infer<typeof LoginResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
export type UserPublic = z.infer<typeof UserPublic>;
export type ProfilePublic = z.infer<typeof ProfilePublic>;
export type ProfileCreateInput = z.infer<typeof ProfileCreateInput>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
export type HealthResponse = z.infer<typeof HealthResponse>;
```

NB: i nomi tipi e schemi collidono per nome — TypeScript permette `type X = ... ; const X = ...` solo se l'`export type` riusa lo stesso identificatore via `z.infer<typeof X>` quando importato. Per evitare ambiguità, in `types.ts` usiamo `import type` e re-export come types. Se TS si lamenta del nome duplicato (`LoginInput` come type e come valore), rinominiamo l'import: `import { LoginInput as LoginInputSchema } from './schemas'; export type LoginInput = z.infer<typeof LoginInputSchema>;`. **Implementatore: applica la seconda forma se la prima dà errore.**

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Se errore "Duplicate identifier", applica il rename suggerito sopra.

- [ ] **Step 3: Commit**

```bash
git add src/shared/
git commit -m "feat(shared): Zod schemas + types condivisi client/server"
```

---

## Task 8: Error middleware Hono

**Files:**
- Create: `src/server/middleware/error.ts`
- Create: `src/server/middleware/error.test.ts`

- [ ] **Step 1: Test**

```ts
// src/server/middleware/error.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { errorHandler, HttpError } from './error';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/throw', () => { throw new HttpError(418, 'I_AM_TEAPOT', 'short and stout'); });
  app.get('/unknown', () => { throw new Error('boom'); });
  return app;
}

test('HttpError mappato a JSON envelope', async () => {
  const res = await makeApp().request('/throw');
  assert.equal(res.status, 418);
  const body = await res.json();
  assert.deepEqual(body, { error: { code: 'I_AM_TEAPOT', message: 'short and stout' } });
});

test('Errori generici → 500 con code INTERNAL', async () => {
  const res = await makeApp().request('/unknown');
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, 'INTERNAL');
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implementare**

```ts
// src/server/middleware/error.ts
import type { ErrorHandler } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(public status: StatusCode, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status,
    );
  }
  console.error('[unhandled error]', err);
  return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500);
};
```

- [ ] **Step 4: Run → PASS**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/error.ts src/server/middleware/error.test.ts
git commit -m "feat(server): error middleware con HttpError envelope"
```

---

## Task 9: Auth middleware `requireSession`

**Files:**
- Create: `src/server/middleware/auth.ts`
- Create: `src/server/middleware/auth.test.ts`

- [ ] **Step 1: Test**

```ts
// src/server/middleware/auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createSession } from '../lib/session';
import { requireSession, type AuthEnv } from './auth';
import { errorHandler } from './error';

async function seedUser(client: import('@libsql/client').Client) {
  const userId = randomUUID();
  const profileId = randomUUID();
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
    args: [userId, 'x@y.it', 'h', 'X'],
  });
  await client.execute({
    sql: `INSERT INTO profiles (id, user_id, slug, display_name) VALUES (?, ?, ?, ?)`,
    args: [profileId, userId, 'default', 'X'],
  });
  return { userId, profileId };
}

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.onError(errorHandler);
  app.use('/protected/*', requireSession);
  app.get('/protected/who', (c) => c.json({ userId: c.get('userId'), profileId: c.get('activeProfileId') }));
  return app;
}

test('requireSession → 401 senza cookie', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/protected/who');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'UNAUTHENTICATED');
});

test('requireSession → 401 con session id inesistente', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/protected/who', {
    headers: { cookie: 'lira_session=non-esiste' },
  });
  assert.equal(res.status, 401);
});

test('requireSession → 200 con session valida e setta userId/profileId', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await seedUser(client);
  const session = await createSession(db, userId, profileId);
  const res = await makeApp(db).request('/protected/who', {
    headers: { cookie: `lira_session=${session.id}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, userId);
  assert.equal(body.profileId, profileId);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```ts
// src/server/middleware/auth.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSession, refreshSession } from '../lib/session';
import type { Db } from '../db/client';
import { HttpError } from './error';

export const SESSION_COOKIE = 'lira_session';

export type AuthEnv = {
  Variables: {
    db: Db;
    userId: string;
    activeProfileId: string;
  };
};

export const requireSession: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Missing session cookie');
  }
  const db = c.get('db');
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired session');
  }
  await refreshSession(db, session.id);
  c.set('userId', session.userId);
  c.set('activeProfileId', session.activeProfileId);
  await next();
};
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/auth.ts src/server/middleware/auth.test.ts
git commit -m "feat(server): requireSession middleware con rolling refresh"
```

---

## Task 10: Route `/api/health`

**Files:**
- Create: `src/server/routes/health.ts`
- Create: `src/server/routes/health.test.ts`

- [ ] **Step 1: Test**

```ts
// src/server/routes/health.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { healthRoute } from './health';

test('GET /api/health → 200 { ok:true, version }', async () => {
  const app = new Hono();
  app.route('/api/health', healthRoute);
  const res = await app.request('/api/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```ts
// src/server/routes/health.ts
import { Hono } from 'hono';

export const healthRoute = new Hono();
healthRoute.get('/', (c) => c.json({ ok: true as const, version: '0.1.0' }));
```

- [ ] **Step 4: Run → PASS + commit**

```bash
git add src/server/routes/health.ts src/server/routes/health.test.ts
git commit -m "feat(api): GET /api/health"
```

---

## Task 11: Routes auth (login/logout/me)

**Files:**
- Create: `src/server/lib/users.ts` (helper riusati da CLI e routes)
- Create: `src/server/routes/auth.ts`
- Create: `src/server/routes/auth.test.ts`

- [ ] **Step 1: Helper `users.ts`**

```ts
// src/server/lib/users.ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, profiles } from '../db/schema';
import { hashPassword } from './password';

export async function findUserByEmail(db: Db, emailLower: string) {
  const [u] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
  return u ?? null;
}

export async function listProfilesForUser(db: Db, userId: string) {
  return db.select().from(profiles).where(eq(profiles.userId, userId));
}

export async function createUserWithDefaultProfile(params: {
  db: Db;
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string; profileId: string }> {
  const emailLower = params.email.toLowerCase().trim();
  const passwordHash = await hashPassword(params.password);
  const userId = randomUUID();
  const profileId = randomUUID();

  await params.db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: emailLower,
      passwordHash,
      name: params.name,
    });
    await tx.insert(profiles).values({
      id: profileId,
      userId,
      slug: 'default',
      displayName: params.name,
    });
  });

  return { userId, profileId };
}
```

- [ ] **Step 2: Test auth routes**

```ts
// src/server/routes/auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { authRoute } from './auth';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/auth', authRoute);
  return app;
}

function getCookieValue(setCookie: string | null, name: string): string | undefined {
  if (!setCookie) return undefined;
  const m = setCookie.split(',').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return m?.split(';')[0]?.split('=')[1];
}

test('login con credenziali corrette → 200 + cookie + body', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const res = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  assert.equal(res.status, 200);
  const cookie = getCookieValue(res.headers.get('set-cookie'), 'lira_session');
  assert.ok(cookie, 'cookie lira_session presente');
  const body = await res.json();
  assert.equal(body.user.email, 'a@b.it');
  assert.equal(body.profiles.length, 1);
  assert.equal(body.activeProfile.slug, 'default');
});

test('login con password sbagliata → 401', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'right-password-1', name: 'A' });
  const res = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'wrong-password-1' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_CREDENTIALS');
});

test('login con email inesistente → 401 (no user enumeration)', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ghost@x.it', password: 'qualsiasi-pw-12' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_CREDENTIALS');
});

test('me senza cookie → 401', async () => {
  const { db } = await createTestDb();
  const res = await makeApp(db).request('/api/auth/me');
  assert.equal(res.status, 401);
});

test('me con cookie valido → 200', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const loginRes = await makeApp(db).request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0];
  const meRes = await makeApp(db).request('/api/auth/me', { headers: { cookie } });
  assert.equal(meRes.status, 200);
  const body = await meRes.json();
  assert.equal(body.user.email, 'a@b.it');
});

test('logout → 200, cookie cancellato, session invalidata', async () => {
  const { db, client } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const loginRes = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0];
  const logoutRes = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logoutRes.status, 200);
  const meRes = await app.request('/api/auth/me', { headers: { cookie } });
  assert.equal(meRes.status, 401);
  const left = await client.execute(`SELECT count(*) as c FROM sessions`);
  assert.equal((left.rows[0] as any).c, 0);
});
```

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Implementare `auth.ts`**

```ts
// src/server/routes/auth.ts
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { LoginInput } from '@shared/schemas';
import { findUserByEmail, listProfilesForUser } from '../lib/users';
import { hashPassword, verifyPassword } from '../lib/password';
import { createSession, deleteSession, SESSION_TTL_MS } from '../lib/session';
import { requireSession, SESSION_COOKIE, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { users } from '../db/schema';
import type { Db } from '../db/client';

export const authRoute = new Hono<AuthEnv>();

// Dummy hash precomputato per mitigare timing attack (1x al primo uso)
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword('00000000000000000000000000000000');
  return dummyHash;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

async function mePayload(db: Db, userId: string, activeProfileId: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new HttpError(500, 'NO_USER', 'User missing');

  const profs = await listProfilesForUser(db, userId);
  if (profs.length === 0) throw new HttpError(500, 'NO_PROFILE', 'User has no profile');
  const active = profs.find((p) => p.id === activeProfileId) ?? profs[0]!;

  return {
    user,
    profiles: profs.map((p) => ({
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      giorniIncasso: p.giorniIncasso,
    })),
    activeProfile: {
      id: active.id,
      slug: active.slug,
      displayName: active.displayName,
      giorniIncasso: active.giorniIncasso,
    },
  };
}

authRoute.post('/login', zValidator('json', LoginInput), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = c.get('db');
  const user = await findUserByEmail(db, email);

  if (!user) {
    // verify dummy per uguagliare timing rispetto al caso "user esistente con password sbagliata"
    await verifyPassword(await getDummyHash(), password);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password non validi');
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password non validi');

  const profs = await listProfilesForUser(db, user.id);
  if (profs.length === 0) throw new HttpError(500, 'NO_PROFILE', 'User has no profile');
  const first = profs[0]!;
  const session = await createSession(db, user.id, first.id);
  setCookie(c, SESSION_COOKIE, session.id, cookieOptions());

  return c.json(await mePayload(db, user.id, session.activeProfileId));
});

authRoute.post('/logout', requireSession, async (c) => {
  const db = c.get('db');
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) await deleteSession(db, sessionId);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoute.get('/me', requireSession, async (c) => {
  const db = c.get('db');
  return c.json(await mePayload(db, c.get('userId'), c.get('activeProfileId')));
});
```

- [ ] **Step 5: Run test → PASS**

Run: `npm test`
Expected: tutti PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/users.ts src/server/routes/auth.ts src/server/routes/auth.test.ts
git commit -m "feat(api): POST /login, POST /logout, GET /me"
```

---

## Task 12: Routes profiles

**Files:**
- Create: `src/server/routes/profiles.ts`
- Create: `src/server/routes/profiles.test.ts`

- [ ] **Step 1: Test**

```ts
// src/server/routes/profiles.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { profilesRoute } from './profiles';
import { authRoute } from './auth';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/auth', authRoute);
  app.route('/api/profiles', profilesRoute);
  return app;
}

async function login(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  return res.headers.get('set-cookie')!.split(';')[0];
}

test('GET /api/profiles ritorna i profili dell utente loggato', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profiles.length, 1);
  assert.equal(body.profiles[0].slug, 'default');
});

test('POST /api/profiles crea un nuovo profilo', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'peru', displayName: 'Peru' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.slug, 'peru');
});

test('POST /api/profiles con slug duplicato → 409', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'default', displayName: 'X' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, 'SLUG_EXISTS');
});

test('POST /api/profiles/:slug/activate cambia activeProfile', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  await app.request('/api/profiles', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'peru', displayName: 'Peru' }),
  });
  const res = await app.request('/api/profiles/peru/activate', { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.activeProfile.slug, 'peru');

  const me = await app.request('/api/auth/me', { headers: { cookie } });
  const meBody = await me.json();
  assert.equal(meBody.activeProfile.slug, 'peru');
});

test('POST /api/profiles/:slug/activate con slug inesistente → 404', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles/ghost/activate', { method: 'POST', headers: { cookie } });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```ts
// src/server/routes/profiles.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { ProfileCreateInput } from '@shared/schemas';
import { profiles, sessions } from '../db/schema';
import { requireSession, SESSION_COOKIE, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { getCookie } from 'hono/cookie';
import { listProfilesForUser } from '../lib/users';
import { setActiveProfile } from '../lib/session';

export const profilesRoute = new Hono<AuthEnv>();

profilesRoute.use('*', requireSession);

function toPublic(p: typeof profiles.$inferSelect) {
  return { id: p.id, slug: p.slug, displayName: p.displayName, giorniIncasso: p.giorniIncasso };
}

profilesRoute.get('/', async (c) => {
  const db = c.get('db');
  const list = await listProfilesForUser(db, c.get('userId'));
  return c.json({ profiles: list.map(toPublic) });
});

profilesRoute.post('/', zValidator('json', ProfileCreateInput), async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const { slug, displayName } = c.req.valid('json');
  try {
    const id = randomUUID();
    await db.insert(profiles).values({ id, userId, slug, displayName });
    const [created] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
    return c.json({ profile: toPublic(created!) });
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      throw new HttpError(409, 'SLUG_EXISTS', `Slug "${slug}" già in uso per questo utente`);
    }
    throw err;
  }
});

profilesRoute.post('/:slug/activate', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const slug = c.req.param('slug');

  const [target] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.userId, userId), eq(profiles.slug, slug)))
    .limit(1);
  if (!target) throw new HttpError(404, 'PROFILE_NOT_FOUND', `Profilo "${slug}" non trovato`);

  const sessionId = getCookie(c, SESSION_COOKIE)!;
  await setActiveProfile(db, sessionId, target.id);

  return c.json({ activeProfile: toPublic(target) });
});
```

- [ ] **Step 4: Run → PASS + commit**

```bash
git add src/server/routes/profiles.ts src/server/routes/profiles.test.ts
git commit -m "feat(api): CRUD profiles + activate"
```

---

## Task 13: Server entry `src/server/index.ts`

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Implementare**

```ts
// src/server/index.ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getDb } from './db/client';
import { healthRoute } from './routes/health';
import { authRoute } from './routes/auth';
import { profilesRoute } from './routes/profiles';
import { errorHandler } from './middleware/error';
import type { AuthEnv } from './middleware/auth';

const app = new Hono<AuthEnv>();

app.use('*', logger());
app.use('*', async (c, next) => {
  c.set('db', getDb());
  await next();
});
app.onError(errorHandler);

app.route('/api/health', healthRoute);
app.route('/api/auth', authRoute);
app.route('/api/profiles', profilesRoute);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`Lira server listening on http://localhost:${port}`);
});
```

- [ ] **Step 2: Smoke test manuale**

Run: `npm run db:migrate` (deve creare `local.db` con tutte le tabelle).
Run: `npm run dev:server` in un terminale.
In un altro: `curl http://localhost:8787/api/health` → `{"ok":true,"version":"0.1.0"}`.
`curl http://localhost:8787/api/auth/me` → `401 {"error":{"code":"UNAUTHENTICATED",...}}`.
Kill il server.

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): Hono entry con mount routes + logger"
```

---

## Task 14: CLI `create-user`

**Files:**
- Create: `scripts/create-user.ts`
- Create: `scripts/create-user.test.ts`

- [ ] **Step 1: Test**

```ts
// scripts/create-user.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile } from '../src/server/lib/users';

test('createUserWithDefaultProfile crea user + profilo default in transazione', async () => {
  const { db, client } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db,
    email: 'X@Y.IT',
    password: 'una-password-lunga-1',
    name: 'Mattia',
  });
  assert.ok(userId);
  assert.ok(profileId);

  const u = await client.execute({ sql: `SELECT email, name FROM users WHERE id = ?`, args: [userId] });
  assert.equal((u.rows[0] as any).email, 'x@y.it'); // normalizzato lowercase
  assert.equal((u.rows[0] as any).name, 'Mattia');

  const p = await client.execute({ sql: `SELECT slug, display_name FROM profiles WHERE id = ?`, args: [profileId] });
  assert.equal((p.rows[0] as any).slug, 'default');
  assert.equal((p.rows[0] as any).display_name, 'Mattia');
});

test('createUserWithDefaultProfile fallisce su email duplicata', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-lunga-1234', name: 'A' });
  await assert.rejects(
    () => createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-lunga-1234', name: 'A2' }),
    /UNIQUE/,
  );
});
```

- [ ] **Step 2: Run → FAIL?**

`createUserWithDefaultProfile` esiste già dal Task 11. Test dovrebbe PASS. Se così è, salta a Step 3 (implementa solo il wrapper CLI).

Run: `npm test`
Expected: PASS sui due nuovi test.

- [ ] **Step 3: Implementare il wrapper CLI**

```ts
// scripts/create-user.ts
import { getDb } from '../src/server/db/client';
import { createUserWithDefaultProfile } from '../src/server/lib/users';

async function main() {
  const [, , email, password, ...nameParts] = process.argv;
  if (!email || !password) {
    console.error('Usage: npm run create-user -- <email> <password> [name]');
    process.exit(1);
  }
  const name = nameParts.join(' ') || email.split('@')[0]!;

  const db = getDb();
  try {
    const { userId, profileId } = await createUserWithDefaultProfile({ db, email, password, name });
    console.log(`User created: ${userId}`);
    console.log(`Default profile: ${profileId}`);
    process.exit(0);
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      console.error(`Email "${email}" già registrata.`);
      process.exit(2);
    }
    console.error('Errore:', err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 4: Smoke test CLI**

Run:
```
npm run db:migrate
npm run create-user -- test@lira.local 'pw-test-lunga-1' 'Test User'
```
Expected: stampa `User created: <uuid>` + `Default profile: <uuid>`. Verificare con `npm run db:studio` o `sqlite3 local.db "SELECT * FROM users"`.

Rilanciare con stessa email → expected `Email "test@lira.local" già registrata.` con exit code 2.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-user.ts scripts/create-user.test.ts
git commit -m "feat(cli): create-user con profilo default in transazione"
```

---

## Task 15: CLI `reset-password`

**Files:**
- Create: `src/server/lib/users.ts` (add `resetPassword` function)
- Create: `scripts/reset-password.ts`
- Create: `scripts/reset-password.test.ts`

- [ ] **Step 1: Test**

```ts
// scripts/reset-password.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile, resetPassword } from '../src/server/lib/users';
import { createSession, getSession } from '../src/server/lib/session';
import { verifyPassword } from '../src/server/lib/password';
import { eq } from 'drizzle-orm';
import { users } from '../src/server/db/schema';

test('resetPassword cambia hash + invalida tutte le sessions', async () => {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db, email: 'a@b.it', password: 'old-password-1234', name: 'A',
  });
  const s1 = await createSession(db, userId, profileId);
  const s2 = await createSession(db, userId, profileId);

  await resetPassword(db, 'a@b.it', 'new-password-5678');

  // hash cambiato
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  assert.equal(await verifyPassword(u!.passwordHash, 'new-password-5678'), true);
  assert.equal(await verifyPassword(u!.passwordHash, 'old-password-1234'), false);

  // sessions invalidate
  assert.equal(await getSession(db, s1.id), null);
  assert.equal(await getSession(db, s2.id), null);
});

test('resetPassword su email inesistente lancia errore', async () => {
  const { db } = await createTestDb();
  await assert.rejects(() => resetPassword(db, 'ghost@x.it', 'pw-1234'), /not found/i);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Aggiungere `resetPassword` a `src/server/lib/users.ts`**

In coda al file:

```ts
import { hashPassword } from './password';
import { deleteAllSessionsForUser } from './session';

export async function resetPassword(db: Db, email: string, newPassword: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  const user = await findUserByEmail(db, emailLower);
  if (!user) throw new Error(`User not found: ${emailLower}`);
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  await deleteAllSessionsForUser(db, user.id);
}
```

(NB: `eq` e `users` sono già importati in `users.ts`; `hashPassword` e `deleteAllSessionsForUser` vanno aggiunti agli import in cima al file.)

- [ ] **Step 4: Implementare il wrapper CLI**

```ts
// scripts/reset-password.ts
import { getDb } from '../src/server/db/client';
import { resetPassword } from '../src/server/lib/users';

async function main() {
  const [, , email, newPassword] = process.argv;
  if (!email || !newPassword) {
    console.error('Usage: npm run reset-password -- <email> <newPassword>');
    process.exit(1);
  }
  try {
    await resetPassword(getDb(), email, newPassword);
    console.log(`Password reset OK per ${email}. Tutte le sessioni invalidate.`);
    process.exit(0);
  } catch (err: any) {
    console.error('Errore:', err?.message ?? err);
    process.exit(2);
  }
}

main();
```

- [ ] **Step 5: Run → PASS + smoke test**

Run: `npm test` → verde.
Smoke: `npm run reset-password -- test@lira.local 'nuova-pw-1234'` → "Password reset OK".

- [ ] **Step 6: Commit**

```bash
git add src/server/lib/users.ts scripts/reset-password.ts scripts/reset-password.test.ts
git commit -m "feat(cli): reset-password con invalidazione sessioni"
```

---

## Task 16: CLI `create-profile`

**Files:**
- Create: `src/server/lib/users.ts` (add `createProfileForUser` function)
- Create: `scripts/create-profile.ts`
- Create: `scripts/create-profile.test.ts`

- [ ] **Step 1: Test**

```ts
// scripts/create-profile.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile, createProfileForUser, listProfilesForUser } from '../src/server/lib/users';

test('createProfileForUser aggiunge un profilo al user esistente', async () => {
  const { db } = await createTestDb();
  const { userId } = await createUserWithDefaultProfile({
    db, email: 'a@b.it', password: 'pw-lunga-1234', name: 'A',
  });
  const p = await createProfileForUser(db, 'a@b.it', 'peru', 'Peru');
  assert.equal(p.slug, 'peru');
  const list = await listProfilesForUser(db, userId);
  assert.equal(list.length, 2);
});

test('createProfileForUser con email inesistente lancia errore', async () => {
  const { db } = await createTestDb();
  await assert.rejects(() => createProfileForUser(db, 'ghost@x.it', 'slug', 'Name'), /not found/i);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Aggiungere `createProfileForUser` a `users.ts`**

```ts
export async function createProfileForUser(
  db: Db,
  email: string,
  slug: string,
  displayName: string,
) {
  const emailLower = email.toLowerCase().trim();
  const user = await findUserByEmail(db, emailLower);
  if (!user) throw new Error(`User not found: ${emailLower}`);
  const id = randomUUID();
  await db.insert(profiles).values({ id, userId: user.id, slug, displayName });
  const [created] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  return created!;
}
```

(L'import di `randomUUID` è già in `users.ts`.)

- [ ] **Step 4: Wrapper CLI**

```ts
// scripts/create-profile.ts
import { getDb } from '../src/server/db/client';
import { createProfileForUser } from '../src/server/lib/users';

async function main() {
  const [, , email, slug, ...nameParts] = process.argv;
  const displayName = nameParts.join(' ');
  if (!email || !slug || !displayName) {
    console.error('Usage: npm run create-profile -- <email> <slug> <displayName>');
    process.exit(1);
  }
  try {
    const p = await createProfileForUser(getDb(), email, slug, displayName);
    console.log(`Profile created: ${p.id} (${p.slug})`);
    process.exit(0);
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      console.error(`Slug "${slug}" già in uso per ${email}.`);
      process.exit(2);
    }
    console.error('Errore:', err?.message ?? err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 5: Run + smoke + commit**

```bash
npm test
npm run create-profile -- test@lira.local peru 'Peru'
git add src/server/lib/users.ts scripts/create-profile.ts scripts/create-profile.test.ts
git commit -m "feat(cli): create-profile per aggiungere profili a user esistente"
```

---

## Task 17: Frontend — tokens.css (port da CalcoliVari)

**Files:**
- Create: `src/client/styles/tokens.css`
- Read: `C:\Users\matti\Documents\Progetti\Lira\CalcoliVari\style.css` (per estrarre i tokens)

- [ ] **Step 1: Estrarre i tokens da CalcoliVari**

Apri `C:\Users\matti\Documents\Progetti\Lira\CalcoliVari\style.css` e trova la sezione `:root { ... }` (e qualsiasi sezione di tokens come `--color-*`, `--space-*`, `--radius-*`, `--font-*`, ecc.). Sono i token "Espresso & Mint" + spacing/radii/typography del sistema "Crisp & Tight".

- [ ] **Step 2: Scrivere `tokens.css`**

Copia **letteralmente** la sezione `:root { ... }` di CalcoliVari `style.css` in `src/client/styles/tokens.css`. Se ci sono regole `@media (prefers-color-scheme: dark)` o `.theme-dark` portale anche. **Non rinominare le variabili.** Non aggiungerne di nuove se non strettamente necessario.

Esempio (placeholder — il contenuto reale viene da `CalcoliVari/style.css`):

```css
:root {
  /* Palette Espresso & Mint (copiata da CalcoliVari/style.css) */
  --bg: /* … */;
  --bg-elev: /* … */;
  --text: /* … */;
  --text-muted: /* … */;
  --espresso: /* … */;
  --mint: /* … */;
  --accent: /* … */;
  --danger: /* … */;
  /* spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  /* radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  /* typography */
  --font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

**Implementatore:** sostituisci i `/* … */` con i valori reali di CalcoliVari. Se la struttura dei tokens è diversa (es. tutto sotto `[data-theme="dark"]`), replicala identica.

- [ ] **Step 3: Commit**

```bash
git add src/client/styles/tokens.css
git commit -m "feat(ui): tokens.css portato da CalcoliVari (Espresso & Mint)"
```

---

## Task 18: Frontend — reset.css + components.css + index.css

**Files:**
- Create: `src/client/styles/reset.css`
- Create: `src/client/styles/components.css`
- Create: `src/client/styles/index.css`

- [ ] **Step 1: `reset.css` minimale**

```css
*, *::before, *::after { box-sizing: border-box; }
html, body, h1, h2, h3, h4, h5, h6, p, ul, ol, figure { margin: 0; padding: 0; }
html { color-scheme: dark; }
body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  min-height: 100dvh;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }
input, textarea, select { font: inherit; color: inherit; }
img, svg { display: block; max-width: 100%; }
```

- [ ] **Step 2: `components.css`**

```css
/* Bottoni */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--bg-elev);
  color: var(--text);
  font-weight: 500;
  transition: background 120ms;
}
.btn:hover { background: color-mix(in srgb, var(--bg-elev) 80%, var(--text)); }
.btn-primary { background: var(--mint); color: var(--espresso); }
.btn-primary:hover { background: color-mix(in srgb, var(--mint) 85%, white); }
.btn-ghost { background: transparent; border-color: var(--bg-elev); }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }

/* Input */
.input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--bg-elev);
  border: 1px solid transparent;
  color: var(--text);
}
.input:focus { outline: 2px solid var(--mint); outline-offset: 1px; }

/* Card */
.card {
  background: var(--bg-elev);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
}

/* Layout app */
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  border-bottom: 1px solid var(--bg-elev);
}
.app-main {
  flex: 1;
  padding: var(--space-4);
  padding-bottom: calc(var(--space-8) + 60px + env(safe-area-inset-bottom, 0));
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}
.bottom-nav {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--bg-elev);
  padding: var(--space-2) var(--space-2) calc(var(--space-2) + env(safe-area-inset-bottom, 0));
  border-top: 1px solid color-mix(in srgb, var(--bg-elev) 70%, var(--text));
}
.bottom-nav .tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2);
  color: var(--text-muted);
  font-size: 12px;
}
.bottom-nav .tab[aria-disabled='true'] { opacity: 0.4; pointer-events: none; }

/* Forms */
.form-row { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4); }
.form-row label { font-size: 14px; color: var(--text-muted); }
.form-error { color: var(--danger); font-size: 14px; margin-top: var(--space-2); }

/* Profilo selector */
.profile-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: 999px;
  background: var(--bg-elev);
  cursor: pointer;
}
```

- [ ] **Step 3: `index.css`**

```css
@import './tokens.css';
@import './reset.css';
@import './components.css';
```

- [ ] **Step 4: Commit**

```bash
git add src/client/styles/
git commit -m "feat(ui): reset + components base + entry CSS"
```

---

## Task 19: Frontend — index.html + main.ts (bootstrap)

**Files:**
- Create: `src/client/index.html`
- Create: `src/client/main.ts`

- [ ] **Step 1: `index.html`**

```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f0f10" />
    <title>Lira</title>
    <link rel="stylesheet" href="./styles/index.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: `main.ts` (router)**

```ts
// src/client/main.ts
import { getMe } from './lib/auth';

type PageModule = { mount: (container: HTMLElement) => () => void };

const routes: Record<string, () => Promise<PageModule>> = {
  '/login': () => import('./pages/login'),
  '/': () => import('./pages/dashboard'),
  '/profiles': () => import('./pages/profiles'),
};

const PUBLIC_ROUTES = new Set(['/login']);

const appEl = document.getElementById('app') as HTMLElement;
let unmount: (() => void) | null = null;

async function navigate(pathname: string, push = true) {
  const route = routes[pathname] ?? routes['/'];
  if (push && pathname !== location.pathname) {
    history.pushState({}, '', pathname);
  }
  const requiresAuth = !PUBLIC_ROUTES.has(pathname);

  if (requiresAuth) {
    const me = await getMe();
    if (!me) return navigate('/login', false);
  }

  if (unmount) unmount();
  appEl.innerHTML = '';
  const mod = await route();
  unmount = mod.mount(appEl);
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const link = target.closest<HTMLElement>('[data-route]');
  if (!link) return;
  const path = link.dataset.route!;
  e.preventDefault();
  navigate(path);
});

window.addEventListener('popstate', () => navigate(location.pathname, false));

navigate(location.pathname, false);
```

- [ ] **Step 3: Commit**

```bash
git add src/client/index.html src/client/main.ts
git commit -m "feat(ui): index.html + router pathname-based"
```

---

## Task 20: Frontend — lib/api.ts + lib/auth.ts

**Files:**
- Create: `src/client/lib/api.ts`
- Create: `src/client/lib/auth.ts`

- [ ] **Step 1: `api.ts`**

```ts
// src/client/lib/api.ts
import type { ErrorEnvelope } from '@shared/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const env = json as ErrorEnvelope | null;
    throw new ApiError(
      res.status,
      env?.error?.code ?? 'HTTP_ERROR',
      env?.error?.message ?? `HTTP ${res.status}`,
      env?.error?.details,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};
```

- [ ] **Step 2: `auth.ts`**

```ts
// src/client/lib/auth.ts
import { api, ApiError } from './api';
import type { LoginInput, MeResponse, ProfileCreateInput, ProfilePublic } from '@shared/types';

export async function getMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>('/api/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function login(input: LoginInput): Promise<MeResponse> {
  return api.post<MeResponse>('/api/auth/login', input);
}

export function logout(): Promise<{ ok: true }> {
  return api.post<{ ok: true }>('/api/auth/logout');
}

export function listProfiles(): Promise<{ profiles: ProfilePublic[] }> {
  return api.get<{ profiles: ProfilePublic[] }>('/api/profiles');
}

export function createProfile(input: ProfileCreateInput): Promise<{ profile: ProfilePublic }> {
  return api.post<{ profile: ProfilePublic }>('/api/profiles', input);
}

export function switchProfile(slug: string): Promise<{ activeProfile: ProfilePublic }> {
  return api.post<{ activeProfile: ProfilePublic }>(`/api/profiles/${encodeURIComponent(slug)}/activate`);
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/client/lib/
git commit -m "feat(ui): fetch wrapper + auth client helpers"
```

---

## Task 21: Frontend — pages/login.ts

**Files:**
- Create: `src/client/pages/login.ts`

- [ ] **Step 1: Implementare**

```ts
// src/client/pages/login.ts
import { login } from '../lib/auth';
import { ApiError } from '../lib/api';

export function mount(container: HTMLElement): () => void {
  container.innerHTML = `
    <main class="app-main" style="display:grid;place-items:center;min-height:100dvh;">
      <form class="card" style="width:100%;max-width:380px;">
        <h1 style="margin-bottom:var(--space-6);">Lira</h1>
        <div class="form-row">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" class="input" required autocomplete="username" />
        </div>
        <div class="form-row">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" class="input" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Accedi</button>
        <p class="form-error" data-error hidden></p>
      </form>
    </main>
  `;

  const form = container.querySelector('form')!;
  const errorEl = container.querySelector<HTMLElement>('[data-error]')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;

  async function onSubmit(e: Event) {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    const fd = new FormData(form);
    try {
      await login({ email: String(fd.get('email')), password: String(fd.get('password')) });
      history.pushState({}, '', '/');
      // forza re-render del router rilanciando navigate via popstate-like:
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Errore inatteso';
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  }

  form.addEventListener('submit', onSubmit);

  return () => form.removeEventListener('submit', onSubmit);
}
```

- [ ] **Step 2: Smoke manuale**

Run server in un terminale: `npm run dev:server`
Run web in un altro: `npm run dev:web`
Browser: `http://localhost:5173/login`
- Email/password vuote → form HTML5 valida
- Credenziali sbagliate → vedi messaggio errore inline
- Credenziali giuste (l'utente creato in Task 14) → redirect a `/` (apparirà vuoto/errore perché dashboard non esiste ancora — OK, prossimo task)

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/login.ts
git commit -m "feat(ui): pagina login"
```

---

## Task 22: Frontend — components/header.ts + components/bottom-nav.ts + pages/dashboard.ts

**Files:**
- Create: `src/client/components/header.ts`
- Create: `src/client/components/bottom-nav.ts`
- Create: `src/client/pages/dashboard.ts`

- [ ] **Step 1: `header.ts`**

```ts
// src/client/components/header.ts
import { logout, switchProfile } from '../lib/auth';
import type { MeResponse } from '@shared/types';

export function renderHeader(me: MeResponse, onUpdate: () => void): string {
  const optionsHtml = me.profiles
    .map((p) => `<option value="${p.slug}" ${p.slug === me.activeProfile.slug ? 'selected' : ''}>${p.displayName}</option>`)
    .join('');
  return `
    <header class="app-header">
      <a class="profile-pill" data-route="/profiles">
        <strong>${me.user.name}</strong>
        <span style="color:var(--text-muted);">·</span>
        <select data-profile-switch>${optionsHtml}</select>
      </a>
      <button class="btn btn-ghost" data-logout>Esci</button>
    </header>
  `;
}

export function wireHeader(container: HTMLElement, onChanged: () => void): () => void {
  const select = container.querySelector<HTMLSelectElement>('[data-profile-switch]');
  const btn = container.querySelector<HTMLButtonElement>('[data-logout]');

  async function onSwitch() {
    if (!select) return;
    try {
      await switchProfile(select.value);
      onChanged();
    } catch (err) {
      console.error('Switch profile failed', err);
    }
  }

  async function onLogout() {
    await logout();
    history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  select?.addEventListener('change', onSwitch);
  btn?.addEventListener('click', onLogout);

  return () => {
    select?.removeEventListener('change', onSwitch);
    btn?.removeEventListener('click', onLogout);
  };
}
```

- [ ] **Step 2: `bottom-nav.ts`**

```ts
// src/client/components/bottom-nav.ts
export function renderBottomNav(): string {
  return `
    <nav class="bottom-nav">
      <a class="tab" aria-disabled="true">📄 Fatture</a>
      <a class="tab" aria-disabled="true">⏳ Scadenze</a>
      <a class="tab" aria-disabled="true">📊 Dichiarazione</a>
    </nav>
  `;
}
```

- [ ] **Step 3: `pages/dashboard.ts`**

```ts
// src/client/pages/dashboard.ts
import { getMe } from '../lib/auth';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;

  async function render() {
    const me = await getMe();
    if (!me) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    container.innerHTML = `
      <div class="app-shell">
        ${renderHeader(me, render)}
        <main class="app-main">
          <div class="card">
            <h2 style="margin-bottom:var(--space-4);">Benvenuto, ${me.user.name}</h2>
            <p style="color:var(--text-muted);margin-bottom:var(--space-2);">Profilo attivo: <strong>${me.activeProfile.displayName}</strong></p>
            <p style="color:var(--text-muted);">Le funzioni fiscali arriveranno negli slice successivi.</p>
          </div>
        </main>
        ${renderBottomNav()}
      </div>
    `;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);
  }

  render();

  return () => { if (cleanupHeader) cleanupHeader(); };
}
```

- [ ] **Step 4: Smoke + commit**

Browser: dopo login arrivi su `/` → vedi nome, profilo attivo, bottom nav (disabilitata). Switch profile dal `<select>` → ricarica dashboard, profilo cambiato. Esci → torni a `/login`.

```bash
git add src/client/components/ src/client/pages/dashboard.ts
git commit -m "feat(ui): header con switch profilo + bottom nav + dashboard placeholder"
```

---

## Task 23: Frontend — pages/profiles.ts

**Files:**
- Create: `src/client/pages/profiles.ts`

- [ ] **Step 1: Implementare**

```ts
// src/client/pages/profiles.ts
import { getMe, listProfiles, createProfile, switchProfile } from '../lib/auth';
import { ApiError } from '../lib/api';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';
import type { ProfilePublic } from '@shared/types';

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;

  async function render() {
    const me = await getMe();
    if (!me) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const { profiles } = await listProfiles();
    container.innerHTML = `
      <div class="app-shell">
        ${renderHeader(me, render)}
        <main class="app-main">
          <div class="card" style="margin-bottom:var(--space-6);">
            <h2 style="margin-bottom:var(--space-4);">Profili</h2>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-3);">
              ${profiles.map((p) => `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3);background:var(--bg);border-radius:var(--radius-md);">
                  <span><strong>${p.displayName}</strong> <span style="color:var(--text-muted);">${p.slug}</span></span>
                  ${p.slug === me.activeProfile.slug
                    ? `<span style="color:var(--mint);">attivo</span>`
                    : `<button class="btn btn-ghost" data-switch="${p.slug}">Attiva</button>`}
                </li>
              `).join('')}
            </ul>
          </div>

          <form class="card" data-create>
            <h3 style="margin-bottom:var(--space-4);">Nuovo profilo</h3>
            <div class="form-row">
              <label>Slug (es. peru)</label>
              <input class="input" name="slug" required pattern="[a-z0-9-]+" maxlength="40" />
            </div>
            <div class="form-row">
              <label>Display name</label>
              <input class="input" name="displayName" required maxlength="100" />
            </div>
            <button type="submit" class="btn btn-primary">Crea</button>
            <p class="form-error" data-error hidden></p>
          </form>
        </main>
        ${renderBottomNav()}
      </div>
    `;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);

    // wire switch
    container.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await switchProfile(btn.dataset.switch!);
        await render();
      });
    });

    // wire create form
    const form = container.querySelector<HTMLFormElement>('[data-create]');
    const errorEl = container.querySelector<HTMLElement>('[data-error]');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!errorEl) return;
      errorEl.hidden = true;
      const fd = new FormData(form);
      try {
        await createProfile({
          slug: String(fd.get('slug')),
          displayName: String(fd.get('displayName')),
        });
        await render();
      } catch (err) {
        errorEl.textContent = err instanceof ApiError ? err.message : 'Errore';
        errorEl.hidden = false;
      }
    });
  }

  render();

  return () => { if (cleanupHeader) cleanupHeader(); };
}
```

- [ ] **Step 2: Smoke**

Browser: vai a `/profiles` cliccando il pill header. Vedi i profili (almeno "default"). Crea "peru" → appare nella lista. Click "Attiva" su peru → diventa "attivo".

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/profiles.ts
git commit -m "feat(ui): pagina profili (lista, crea, attiva)"
```

---

## Task 24: README setup section

**Files:**
- Modify: `README.md` (verificare se esiste; altrimenti crearlo)

- [ ] **Step 1: Verificare README esistente**

Run: `ls README.md`. Se non esiste → Step 2 con creazione. Se esiste → Step 2 con merge della sezione.

- [ ] **Step 2: Scrivere/aggiornare README con sezione "Primo setup"**

Se non esiste, crea `README.md`:

```markdown
# Lira

App fullstack per Partita IVA italiana — successore di CalcoliVari.

Vedi [`CLAUDE.md`](./CLAUDE.md) per panoramica completa, [`docs/architecture.md`](./docs/architecture.md) per il runtime, [`docs/data-model.md`](./docs/data-model.md) per lo schema.

## Primo setup (dev locale)

```bash
# 1. Installa dipendenze
npm install

# 2. Configura env (dev locale usa SQLite file)
cp .env.example .env
# .env è già pronto con DATABASE_URL=file:./local.db

# 3. Applica migrations
npm run db:migrate

# 4. Crea il primo utente + profilo default (in transazione)
npm run create-user -- matas300@gmail.com 'PasswordSicuraQui' 'Mattia'

# 5. (Opzionale) Aggiungi un secondo profilo allo stesso utente
npm run create-profile -- matas300@gmail.com peru 'Peru'

# 6. Avvia dev server (Hono + Vite)
npm run dev
# → web: http://localhost:5173
# → api: http://localhost:8787
```

## Primo setup (Turso remoto)

Solo se vuoi puntare a un DB remoto in dev/staging/prod.

```bash
# Installa Turso CLI (una tantum)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login

# Crea DB
turso db create lira-prod --location fra
turso db tokens create lira-prod --expiration none
# Output → copia in .env:
# DATABASE_URL=libsql://lira-prod-<org>.turso.io
# DATABASE_AUTH_TOKEN=<jwt>

npm run db:migrate
npm run create-user -- ...
```

## CLI admin

| Comando | Cosa fa |
|---|---|
| `npm run create-user -- <email> <password> [name]` | Crea user + profilo `default` in una transazione |
| `npm run create-profile -- <email> <slug> <displayName>` | Aggiunge un profilo a un user esistente |
| `npm run reset-password -- <email> <newPassword>` | Resetta la password e invalida tutte le sessioni dell'utente |

Non esiste un endpoint HTTP pubblico per creare/registrare utenti: l'app è privata.

## Test

```bash
npm test           # tutti i test (integration + unit)
npm run typecheck  # tsc --noEmit
```

## Build produzione

```bash
npm run build      # build:web (Vite) + build:server (tsc)
npm start          # node dist/server/index.js
```

## Stack

Vedi `docs/architecture.md`. Riassunto: Vite + TS vanilla → Hono (Node 22) → Drizzle → libSQL (file:// o Turso). Cookie sessions HTTP-only + Argon2id. Deploy target: Fly.io 512MB.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README con istruzioni setup e CLI admin"
```

---

## Task 25: End-to-end smoke + Definition of Done check

**Files:** nessuno

- [ ] **Step 1: Pulizia ambiente**

Cancella `local.db` e `local.db-journal` se esistono (per partire da zero):
```
del local.db local.db-journal
```
(PowerShell)

- [ ] **Step 2: Esegui il flow completo dalla riga di comando**

```bash
npm install
npm run db:migrate
# Expected: "Migrations applied."

npm run create-user -- matas300@gmail.com 'TestPasswordLunga1' 'Mattia'
# Expected: "User created: <uuid>" + "Default profile: <uuid>"

npm run create-profile -- matas300@gmail.com peru 'Peru'
# Expected: "Profile created: <uuid> (peru)"

npm run typecheck
# Expected: zero errori

npm test
# Expected: tutti verdi (≈ 30+ test totali)
```

- [ ] **Step 3: Smoke UI**

```bash
npm run dev
```

Apri `http://localhost:5173`:
1. Vedi pagina login con dark theme.
2. Login con `matas300@gmail.com` / `TestPasswordLunga1` → arrivi su `/`.
3. Header mostra "Mattia · default" + bottone "Esci".
4. Cambia profilo dal dropdown → "peru". La pagina rerendera.
5. Click sul pill nell'header → vai a `/profiles`. Vedi entrambi i profili. Crea "demo" → appare. Attivalo.
6. Esci → torni a `/login`. Cookie sparito (verifica DevTools → Application → Cookies).
7. Prova a fare `curl http://localhost:8787/api/profiles` → 401.

- [ ] **Step 4: Reset password smoke**

```bash
npm run reset-password -- matas300@gmail.com 'NuovaPwd123'
# Expected: "Password reset OK ..."
```

In browser: ricarica `/` → ti rimanda a `/login` (cookie invalidato). Prova vecchia password → 401. Prova nuova password → OK.

- [ ] **Step 5: Confronto contro Definition of Done dello spec**

Apri `docs/superpowers/specs/2026-05-25-foundation-slice-design.md` sezione "Definition of Done" e spunta ogni checkpoint contro lo stato attuale. Se qualcosa manca, **non** chiudere lo slice: crea task aggiuntivo e completa.

- [ ] **Step 6: Tag versione (opzionale)**

```bash
git tag -a v0.1.0-foundation -m "Foundation slice complete"
```

- [ ] **Step 7: Commit finale (se serve)**

Se nessun file è stato modificato in questi step, skip il commit. Altrimenti:
```bash
git status
git add -A
git commit -m "chore: end-to-end smoke + Definition of Done verificato"
```

---

## Riepilogo task

| # | Cosa | TDD |
|---|---|---|
| 1 | Config + dipendenze | — |
| 2 | Drizzle schema completo | — |
| 3 | Baseline migration generata | — |
| 4 | DB client + migrate runner + test helper | sì |
| 5 | password.ts | strict |
| 6 | session.ts | strict |
| 7 | Zod schemas condivisi | — |
| 8 | Error middleware | sì |
| 9 | requireSession middleware | sì |
| 10 | Route /api/health | sì |
| 11 | Route /api/auth (login/logout/me) | sì |
| 12 | Route /api/profiles | sì |
| 13 | Server entry index.ts | smoke |
| 14 | CLI create-user | sì |
| 15 | CLI reset-password | sì |
| 16 | CLI create-profile | sì |
| 17 | tokens.css portato | — |
| 18 | reset/components/index CSS | — |
| 19 | index.html + main.ts router | — |
| 20 | api.ts + auth.ts lib client | — |
| 21 | pages/login.ts | smoke |
| 22 | header + bottom-nav + dashboard | smoke |
| 23 | pages/profiles.ts | smoke |
| 24 | README setup | — |
| 25 | End-to-end smoke + DoD | — |

**Totale**: 25 task. La maggior parte ha test (server side + middleware + CLI helpers). UI testata solo manualmente in questo slice — gli E2E arrivano in Hardening.
