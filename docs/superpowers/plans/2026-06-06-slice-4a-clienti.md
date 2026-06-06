# Slice 4A — Clienti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Clienti module as a complete vertical slice — server CRUD `/api/clienti` with shared server-side validation (P.IVA check-digit, CF format, SDI/IPA per tipo, PEC), P.IVA autofill, plus the first real frontend page (`/clienti`: list + search + reusable modal CRUD + autofill + single-default).

**Architecture:** Pure shared validators (`@shared/validators`) reused by Zod refines and tests. Server route follows `routes/pagamenti.ts` (Hono, `requireSession`, scoped to `activeProfileId`, `toPublic` mapping, `db.transaction` for single-default). Autofill is a pure-ish lib with injectable `fetch`, wrapped by `GET /lookup/:piva` reading an env key with graceful `503` degradation. Frontend follows `pages/profiles.ts` (`mount(container) => unmount`, `innerHTML` + `addEventListener`, no framework) on a new reusable `components/modal.ts`.

**Tech Stack:** TypeScript strict, Hono, Drizzle (libSQL), Zod, Vite vanilla TS, Node `--test`.

**Reference patterns (read before starting):**
- `src/server/routes/pagamenti.ts` — route shape, `toPublic`, `HttpError`, PATCH/DELETE 404 scoping.
- `src/server/routes/pagamenti.test.ts` — `makeApp()` test harness.
- `src/server/routes/year-settings.ts:207-214` — `db.transaction` delete-then-insert.
- `src/client/pages/profiles.ts` — page mount/render/wire pattern.
- `src/shared/schemas.ts:58-120` — enum + Zod object + refine + `.extend` conventions.
- `CalcoliVari/clienti-autofill.js` — `normalizeResponse` / `pickAddress` logic to port.

**Conventions to honor:** TS strict with `noUncheckedIndexedAccess` (always guard `arr[0]!` or check). ESM. No global side-effects. Errors via `HttpError(status, code, message)` + existing `errorHandler`. Validation envelope `{ error: { code, message, details? } }`.

---

## Task 1: Shared validators (`@shared/validators`)

Pure functions, zero DOM/DB. Reused by Zod refines (Task 2) and route logic.

**Files:**
- Create: `src/shared/validators.ts`
- Test: `src/shared/validators.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/validators.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPartitaIvaIT,
  isValidCodiceFiscaleFormat,
  isValidCodiceSdi,
  isValidPec,
} from './validators';

test('isValidPartitaIvaIT — P.IVA reali valide (check-digit corretto)', () => {
  // P.IVA note valide (check-digit verificato a mano con algoritmo ufficiale).
  assert.equal(isValidPartitaIvaIT('00743110157'), true); // esempio classico
  assert.equal(isValidPartitaIvaIT('07643520567'), true);
});

test('isValidPartitaIvaIT — check-digit errato', () => {
  // ultima cifra alterata rispetto a una valida
  assert.equal(isValidPartitaIvaIT('00743110158'), false);
});

test('isValidPartitaIvaIT — lunghezza/formato errato', () => {
  assert.equal(isValidPartitaIvaIT('123'), false);
  assert.equal(isValidPartitaIvaIT('0074311015a'), false);
  assert.equal(isValidPartitaIvaIT('007431101570'), false); // 12 cifre
  assert.equal(isValidPartitaIvaIT(''), false);
});

test('isValidCodiceFiscaleFormat — solo formato 16 alfanumerici uppercase', () => {
  assert.equal(isValidCodiceFiscaleFormat('RSSMRA80A01H501U'), true);
  assert.equal(isValidCodiceFiscaleFormat('rssmra80a01h501u'), false); // lowercase
  assert.equal(isValidCodiceFiscaleFormat('RSSMRA80A01H501'), false); // 15
  assert.equal(isValidCodiceFiscaleFormat('RSSMRA80A01H501!'), false); // simbolo
});

test('isValidCodiceSdi — PA 6 char, altri 7 char', () => {
  assert.equal(isValidCodiceSdi('UFXXXX', 'PA'), true);
  assert.equal(isValidCodiceSdi('0000000', 'PA'), false); // PA vuole 6
  assert.equal(isValidCodiceSdi('0000000', 'PG'), true);
  assert.equal(isValidCodiceSdi('ABC1234', 'Estero'), true);
  assert.equal(isValidCodiceSdi('ABC123', 'PF'), false); // privato vuole 7
  assert.equal(isValidCodiceSdi('abc1234', 'PG'), false); // lowercase
});

test('isValidPec — email base', () => {
  assert.equal(isValidPec('mario@pec.it'), true);
  assert.equal(isValidPec('mario@pec'), false);
  assert.equal(isValidPec('mariopec.it'), false);
  assert.equal(isValidPec('a b@pec.it'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/validators.test.ts` (or `node --test --import tsx src/shared/validators.test.ts` if that's the project runner — check `package.json` `scripts.test`)
Expected: FAIL — `Cannot find module './validators'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/validators.ts
//
// Validatori puri e riusabili per anagrafica clienti (Slice 4A).
// Nessuna dipendenza DOM/DB: usati sia dai refine Zod (shared/schemas)
// sia dalla route, sia dai test in isolamento.

export type TipoCliente = 'PF' | 'PG' | 'PA' | 'Estero';

/**
 * Check-digit ufficiale P.IVA italiana (algoritmo Luhn italiano).
 * - 11 cifre esatte.
 * - Posizioni dispari (1-indexed: 1,3,5,7,9) sommate as-is.
 * - Posizioni pari (2,4,6,8,10) raddoppiate; se >9 sottrai 9; poi sommate.
 * - check = (10 - (somma % 10)) % 10; valida se uguale alla 11ª cifra.
 */
export function isValidPartitaIvaIT(piva: string): boolean {
  if (typeof piva !== 'string' || !/^\d{11}$/.test(piva)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const d = piva.charCodeAt(i) - 48; // '0' === 48
    if (i % 2 === 0) {
      // posizione 1-indexed dispari → indice 0-based pari
      sum += d;
    } else {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  const check = (10 - (sum % 10)) % 10;
  return check === piva.charCodeAt(10) - 48;
}

/** Solo formato: 16 caratteri alfanumerici uppercase. Check-digit fuori scope 4A. */
export function isValidCodiceFiscaleFormat(cf: string): boolean {
  return typeof cf === 'string' && /^[A-Z0-9]{16}$/.test(cf);
}

/**
 * SDI/IPA per tipo cliente:
 * - PA → codice IPA 6 char alfanumerici uppercase.
 * - PF/PG/Estero → 7 char alfanumerici uppercase (default '0000000').
 */
export function isValidCodiceSdi(sdi: string, tipo: TipoCliente): boolean {
  if (typeof sdi !== 'string') return false;
  return tipo === 'PA' ? /^[A-Z0-9]{6}$/.test(sdi) : /^[A-Z0-9]{7}$/.test(sdi);
}

/** PEC: email base. Nullable/opzionale gestito dal chiamante. */
export function isValidPec(pec: string): boolean {
  return typeof pec === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pec);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shared/validators.test.ts`
Expected: PASS (all 6 tests). If a "real" P.IVA fails, the test value is wrong — recompute the check digit by hand from the algorithm and fix the fixture, not the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/shared/validators.ts src/shared/validators.test.ts
git commit -m "feat(clienti): validatori puri P.IVA check-digit + CF/SDI/PEC"
```

---

## Task 2: Zod schemas + derived types

Extend `shared/schemas.ts` and `shared/types.ts`. Normalization (uppercase nazione/provincia/SDI/CF, trim) via `.transform` on the object; cross-field rules via `.refine`.

**Files:**
- Modify: `src/shared/schemas.ts` (append after Pagamenti block, ~line 120)
- Modify: `src/shared/types.ts` (append derived types)
- Test: `src/shared/schemas.test.ts` (create if absent; else append)

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/schemas.test.ts  (create or append)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClienteCreateInput } from './schemas';

test('ClienteCreateInput — minimo valido PG con default', () => {
  const r = ClienteCreateInput.parse({ nome: 'ACME Srl', partitaIva: '00743110157' });
  assert.equal(r.tipoCliente, 'PG');
  assert.equal(r.codiceSdi, '0000000');
  assert.equal(r.nazione, 'IT');
});

test('ClienteCreateInput — normalizza uppercase nazione/provincia/SDI/CF', () => {
  const r = ClienteCreateInput.parse({
    nome: 'X', partitaIva: '00743110157',
    provincia: 'mi', nazione: 'it', codiceSdi: 'abc1234',
  });
  assert.equal(r.provincia, 'MI');
  assert.equal(r.nazione, 'IT');
  assert.equal(r.codiceSdi, 'ABC1234');
});

test('ClienteCreateInput — P.IVA con check-digit errato → throw', () => {
  assert.throws(() => ClienteCreateInput.parse({ nome: 'X', partitaIva: '00743110158' }));
});

test('ClienteCreateInput — cliente IT senza P.IVA né CF → throw (FatturaPA 1.4.1.2)', () => {
  assert.throws(() => ClienteCreateInput.parse({ nome: 'X', nazione: 'IT' }));
});

test('ClienteCreateInput — cliente Estero senza P.IVA/CF è ammesso', () => {
  const r = ClienteCreateInput.parse({ nome: 'Foreign Co', nazione: 'DE', tipoCliente: 'Estero' });
  assert.equal(r.nome, 'Foreign Co');
});

test('ClienteCreateInput — PA richiede SDI 6 char', () => {
  assert.throws(() => ClienteCreateInput.parse({
    nome: 'Comune', tipoCliente: 'PA', codiceFiscale: 'RSSMRA80A01H501U', codiceSdi: '0000000',
  }));
  const ok = ClienteCreateInput.parse({
    nome: 'Comune', tipoCliente: 'PA', codiceFiscale: 'RSSMRA80A01H501U', codiceSdi: 'ufxxxx',
  });
  assert.equal(ok.codiceSdi, 'UFXXXX');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/schemas.test.ts`
Expected: FAIL — `ClienteCreateInput` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/shared/schemas.ts` (after the Pagamenti block):

```ts
// ───── Clienti (Slice 4A) ─────
import {
  isValidPartitaIvaIT,
  isValidCodiceFiscaleFormat,
  isValidCodiceSdi,
  isValidPec,
} from './validators';

export const TipoClienteEnum = z.enum(['PF', 'PG', 'PA', 'Estero']);

const optStr = z.string().trim().optional().nullable();

const ClienteBase = z.object({
  nome: z.string().trim().min(1).max(200),
  tipoCliente: TipoClienteEnum.default('PG'),
  partitaIva: z.string().trim().optional().nullable().transform((v) => (v ? v : null)),
  codiceFiscale: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v ? v : null)),
  codiceSdi: z.string().trim().toUpperCase().default('0000000'),
  pec: optStr,
  indirizzo: optStr,
  cap: optStr,
  citta: optStr,
  provincia: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v ? v : null)),
  nazione: z.string().trim().toUpperCase().length(2).default('IT'),
  descrizioneStandard: optStr,
  note: optStr,
  isDefault: z.boolean().optional(),
});

function applyClienteRefines<T extends z.ZodTypeAny>(schema: T): T {
  return schema
    .refine((c: any) => c.partitaIva == null || isValidPartitaIvaIT(c.partitaIva), {
      message: 'Partita IVA non valida (check-digit)', path: ['partitaIva'],
    })
    .refine((c: any) => c.codiceFiscale == null || isValidCodiceFiscaleFormat(c.codiceFiscale), {
      message: 'Codice fiscale: formato non valido (16 alfanumerici)', path: ['codiceFiscale'],
    })
    .refine((c: any) => c.codiceSdi == null || c.tipoCliente == null
      || isValidCodiceSdi(c.codiceSdi, c.tipoCliente), {
      message: 'Codice SDI non valido per il tipo cliente', path: ['codiceSdi'],
    })
    .refine((c: any) => c.pec == null || isValidPec(c.pec), {
      message: 'PEC non valida', path: ['pec'],
    })
    .refine((c: any) => c.nazione !== 'IT' || c.partitaIva != null || c.codiceFiscale != null, {
      message: 'Cliente italiano: richiesta Partita IVA o Codice Fiscale (FatturaPA §1.4.1.2)',
      path: ['partitaIva'],
    }) as unknown as T;
}

export const ClienteCreateInput = applyClienteRefines(ClienteBase);
// Update: tutti i campi opzionali; stesse regole cross-field.
export const ClienteUpdateInput = applyClienteRefines(ClienteBase.partial());

export const ClientePublic = z.object({
  id: z.string(),
  profileId: z.string(),
  nome: z.string(),
  tipoCliente: TipoClienteEnum,
  partitaIva: z.string().nullable(),
  codiceFiscale: z.string().nullable(),
  codiceSdi: z.string(),
  pec: z.string().nullable(),
  indirizzo: z.string().nullable(),
  cap: z.string().nullable(),
  citta: z.string().nullable(),
  provincia: z.string().nullable(),
  nazione: z.string(),
  descrizioneStandard: z.string().nullable(),
  isDefault: z.boolean(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PivaLookupData = z.object({
  nome: z.string().optional(),
  codiceFiscale: z.string().optional(),
  indirizzo: z.string().optional(),
  cap: z.string().optional(),
  citta: z.string().optional(),
  provincia: z.string().optional(),
  pec: z.string().optional(),
  codiceSdi: z.string().optional(),
});

export const PivaLookupResult = z.object({
  ok: z.boolean(),
  data: PivaLookupData.optional(),
  code: z.string().optional(),
});
```

> **`noUncheckedIndexedAccess` note:** the `(c: any)` casts in refines are deliberate — Zod's refine arg type for a `.partial()`-derived schema is awkward to type narrowly. Keep them `any` and rely on the runtime checks.

Append to `src/shared/types.ts`:

```ts
import {
  TipoClienteEnum as TipoClienteEnumSchema,
  ClienteCreateInput as ClienteCreateInputSchema,
  ClienteUpdateInput as ClienteUpdateInputSchema,
  ClientePublic as ClientePublicSchema,
  PivaLookupData as PivaLookupDataSchema,
  PivaLookupResult as PivaLookupResultSchema,
} from './schemas';

export type TipoCliente = z.infer<typeof TipoClienteEnumSchema>;
export type ClienteCreateInput = z.infer<typeof ClienteCreateInputSchema>;
export type ClienteUpdateInput = z.infer<typeof ClienteUpdateInputSchema>;
export type ClientePublic = z.infer<typeof ClientePublicSchema>;
export type PivaLookupData = z.infer<typeof PivaLookupDataSchema>;
export type PivaLookupResult = z.infer<typeof PivaLookupResultSchema>;
```

> Merge the new `import { ... } from './schemas'` into the existing import block in `types.ts` rather than adding a duplicate statement.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/shared/schemas.test.ts`
Expected: PASS. Also run `npx tsc -p tsconfig.json --noEmit` to confirm no type errors from the new derived types.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts src/shared/schemas.test.ts src/shared/types.ts
git commit -m "feat(clienti): Zod ClienteCreate/Update/Public + normalizzazione + refine FatturaPA"
```

---

## Task 3: P.IVA autofill lib (`piva-lookup.ts`)

Port `normalizeResponse`/`pickAddress` from CalcoliVari. Injectable `fetch` → testable without network. **No hardcoded key** — key is passed in by the route from env.

**Files:**
- Create: `src/server/lib/piva-lookup.ts`
- Test: `src/server/lib/piva-lookup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/lib/piva-lookup.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupPartitaIva } from './piva-lookup';

const PIVA = '00743110157';

function fakeFetch(status: number, json: unknown): typeof fetch {
  return (async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => json,
  })) as unknown as typeof fetch;
}

test('lookup ok — normalizza risposta data[] (alias array)', async () => {
  const r = await lookupPartitaIva(PIVA, {
    apiKey: 'k',
    fetchImpl: fakeFetch(200, {
      success: true,
      data: [{
        companyName: 'ACME SRL', taxCode: 'RSSMRA80A01H501U',
        address: { registeredOffice: { streetName: 'VIA MILANO 150', zipCode: '20100', town: 'MILANO', province: 'mi' } },
        pec: 'acme@pec.it', sdiCode: 'ufxxxx',
      }],
    }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.data?.nome, 'ACME SRL');
  assert.equal(r.data?.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(r.data?.indirizzo, 'VIA MILANO 150');
  assert.equal(r.data?.cap, '20100');
  assert.equal(r.data?.citta, 'MILANO');
  assert.equal(r.data?.provincia, 'MI');
  assert.equal(r.data?.pec, 'acme@pec.it');
  assert.equal(r.data?.codiceSdi, 'UFXXXX');
});

test('lookup ok — risposta data come oggetto (non array)', async () => {
  const r = await lookupPartitaIva(PIVA, {
    apiKey: 'k',
    fetchImpl: fakeFetch(200, { data: { denominazione: 'Beta', codice_fiscale: 'X' } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.data?.nome, 'Beta');
});

test('lookup 404 → NOT_FOUND', async () => {
  const r = await lookupPartitaIva(PIVA, { apiKey: 'k', fetchImpl: fakeFetch(404, {}) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_FOUND');
});

test('lookup throw → NETWORK', async () => {
  const throwing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  const r = await lookupPartitaIva(PIVA, { apiKey: 'k', fetchImpl: throwing });
  assert.equal(r.code, 'NETWORK');
});

test('lookup senza apiKey → NO_KEY', async () => {
  const r = await lookupPartitaIva(PIVA, {});
  assert.equal(r.code, 'NO_KEY');
});

test('lookup piva invalida → INVALID_PIVA (prima di toccare la rete)', async () => {
  const r = await lookupPartitaIva('123', { apiKey: 'k' });
  assert.equal(r.code, 'INVALID_PIVA');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/lib/piva-lookup.test.ts`
Expected: FAIL — `Cannot find module './piva-lookup'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/lib/piva-lookup.ts
//
// Lookup anagrafica cliente da P.IVA via company.openapi.com (IT-start).
// Porta normalizeResponse/pickAddress da CalcoliVari/clienti-autofill.js.
// `fetchImpl` iniettabile → testabile senza rete. NESSUNA key hardcoded:
// la key arriva dal chiamante (route legge process.env.OPENAPI_COMPANY_KEY).

import type { PivaLookupData, PivaLookupResult } from '@shared/types';

type LookupCode = 'INVALID_PIVA' | 'NO_KEY' | 'NOT_FOUND' | 'NETWORK';

interface LookupOpts {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function s(v: unknown): string {
  return (v == null ? '' : String(v)).trim();
}

function pickAddress(d: any): { street: string; zip: string; city: string; province: string } {
  const addr = d.address || {};
  const reg = addr.registeredOffice || addr.registered_office || (d.address ? addr : d);
  let full = s(reg.streetName);
  if (!full) {
    const base = s(reg.street || reg.toponimo || reg.via || reg.indirizzo);
    const num = s(reg.streetNumber || reg.street_number || reg.civico);
    full = base + (base && num ? ' ' + num : '');
  }
  return {
    street: full,
    zip: s(reg.zipCode || reg.zip_code || reg.zip || reg.cap),
    city: s(reg.town || reg.city || reg.comune || reg.citta),
    province: s(reg.province || reg.provincia).toUpperCase(),
  };
}

function normalizeResponse(raw: any): PivaLookupData {
  const payload = raw || {};
  let d = payload.data;
  if (Array.isArray(d)) d = d[0] || {};
  else if (!d || typeof d !== 'object') d = payload;
  const a = pickAddress(d);
  const out: PivaLookupData = {};
  const nome = s(d.companyName || d.denominazione || d.ragione_sociale || d.nome);
  const cf = s(d.taxCode || d.codice_fiscale || d.cf).toUpperCase();
  const pec = s(d.pec || d.email_pec);
  const sdi = s(d.sdiCode || d.codice_sdi).toUpperCase();
  if (nome) out.nome = nome;
  if (cf) out.codiceFiscale = cf;
  if (a.street) out.indirizzo = a.street;
  if (a.zip) out.cap = a.zip;
  if (a.city) out.citta = a.city;
  if (a.province) out.provincia = a.province;
  if (pec) out.pec = pec;
  if (sdi) out.codiceSdi = sdi;
  return out;
}

function fail(code: LookupCode): PivaLookupResult {
  return { ok: false, code };
}

export async function lookupPartitaIva(piva: string, opts: LookupOpts): Promise<PivaLookupResult> {
  const clean = (piva || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(clean)) return fail('INVALID_PIVA');
  if (!opts.apiKey) return fail('NO_KEY');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('NETWORK');
  try {
    const res = await fetchImpl(`https://company.openapi.com/IT-start/${clean}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
    if (res.status === 404) return fail('NOT_FOUND');
    if (!res.ok) return fail('NETWORK');
    const json = await res.json();
    return { ok: true, data: normalizeResponse(json) };
  } catch {
    return fail('NETWORK');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/lib/piva-lookup.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/piva-lookup.ts src/server/lib/piva-lookup.test.ts
git commit -m "feat(clienti): piva-lookup lib (fetch iniettato, normalizzazione openapi)"
```

---

## Task 4: Route `/api/clienti` — CRUD + single-default + duplicate

Follows `routes/pagamenti.ts`. New `toPublic` maps `is_default` integer → `isDefault` boolean. Single-default in `db.transaction`. UNIQUE violation → `409 CLIENTE_DUPLICATE`.

**Files:**
- Create: `src/server/middleware/validate.ts` (shared zValidator wrapper → `400 VALIDATION` envelope)
- Create: `src/server/routes/clienti.ts`
- Test: `src/server/routes/clienti.test.ts`

> **Why `validate.ts`:** the spec (§5/§11) requires Zod failures to surface as `{ error: { code: 'VALIDATION', message, details } }`. The default `@hono/zod-validator` instead returns a raw `ZodError` body with no `error.code`. No existing route exposes this (none assert on a pure-Zod 400). This task introduces a one-file wrapper that throws `HttpError(400,'VALIDATION',…)` via the existing `errorHandler`, giving a consistent envelope reused by all future routes (4B+).

- [ ] **Step 1: Write the failing test**

```ts
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

test('single-default: creo 2 clienti default → solo l’ultimo resta default', async () => {
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

test('scoping: cliente di altro profilo → 404 su PATCH e DELETE', async () => {
  const { app: appA, headers: hA } = await makeApp('a@x.it');
  const { headers: hB, app: appB } = await makeApp('b@x.it');
  const created = await (await appA.request('/api/clienti', {
    method: 'POST', headers: J(hA), body: JSON.stringify({ nome: 'A', partitaIva: '00743110157' }),
  })).json() as { id: string };
  // appB è un'app separata su un DB separato → l'id non esiste affatto: 404.
  const r = await appB.request(`/api/clienti/${created.id}`, {
    method: 'PATCH', headers: J(hB), body: JSON.stringify({ citta: 'X' }),
  });
  assert.equal(r.status, 404);
});
```

> The cross-profile test uses two independent `makeApp()` DBs (each `createTestDb` is in-memory and isolated), which is enough to prove the route 404s on an id absent from the active profile. A same-DB-two-profiles variant is not needed for 4A.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/routes/clienti.test.ts`
Expected: FAIL — `Cannot find module './clienti'`.

- [ ] **Step 3a: Create the shared validation wrapper**

```ts
// src/server/middleware/validate.ts
//
// Wrapper su @hono/zod-validator che converte i fallimenti Zod nell'envelope
// standard dell'app: HttpError(400, 'VALIDATION', message, details) → errorHandler.
// Riusabile da tutte le route (clienti 4A in poi).

import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';
import { HttpError } from './error';

export function zJson<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      throw new HttpError(
        400,
        'VALIDATION',
        'Dati non validi',
        result.error.issues,
      );
    }
  });
}
```

> The `zValidator` hook receives the parse result; throwing inside it is caught by `app.onError(errorHandler)`. `result.error.issues` is the Zod issue array → goes into `details`.

- [ ] **Step 3b: Write the route**

```ts
// src/server/routes/clienti.ts
//
// CRUD anagrafica clienti + autofill da P.IVA. Pattern routes/pagamenti.ts:
// requireSession, tutto scoped a c.get('activeProfileId'), validazione Zod.
//
// - is_default (integer 0/1) ↔ isDefault (boolean) in toPublic.
// - Single-default garantito in db.transaction (≤1 default per profilo).
// - UNIQUE (profile,piva)/(profile,cf) violata → 409 CLIENTE_DUPLICATE.

import { Hono } from 'hono';
import { and, asc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ClienteCreateInput, ClienteUpdateInput } from '@shared/schemas';
import { clienti } from '../db/schema';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { requireSession, type AuthEnv } from '../middleware/auth';
import { lookupPartitaIva } from '../lib/piva-lookup';

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
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
}

/** Azzera is_default sugli altri clienti del profilo (dentro una tx). */
async function clearOtherDefaults(tx: any, profileId: string, keepId: string): Promise<void> {
  await tx.update(clienti).set({ isDefault: 0 })
    .where(and(eq(clienti.profileId, profileId), ne(clienti.id, keepId)));
}

// ─────────── GET / ───────────
clientiRoute.get('/', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const rows = await db.select().from(clienti)
    .where(eq(clienti.profileId, profileId))
    .orderBy(asc(clienti.nome));
  return c.json(rows.map(toPublic));
});

// ─────────── POST / ───────────
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

// ─────────── PATCH /:id ───────────
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

// ─────────── DELETE /:id ───────────
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

// ─────────── GET /lookup/:piva ─────────── (Task 5 adds the handler body)
```

> **Note:** `zJson` (Step 3a) is what produces `error.code === 'VALIDATION'`. The other routes (`pagamenti`, `year-settings`) still use the bare `zValidator` — that's fine; this plan does not refactor them. Their custom business errors (e.g. `INVALID_SOSTITUTIVA_5`) are separate handler-level `HttpError`s, not Zod failures.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/routes/clienti.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/validate.ts src/server/routes/clienti.ts src/server/routes/clienti.test.ts
git commit -m "feat(clienti): route CRUD scoped + single-default tx + 409 duplicate + envelope VALIDATION"
```

---

## Task 5: Autofill endpoint `GET /api/clienti/lookup/:piva`

Reads env key, maps `PivaLookupResult` codes → HTTP. Graceful `503` when no key.

**Files:**
- Modify: `src/server/routes/clienti.ts` (replace the trailing `// Task 5` comment)
- Test: `src/server/routes/clienti.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `clienti.test.ts`. Because the handler reads `process.env.OPENAPI_COMPANY_KEY` and uses the real `globalThis.fetch`, the test sets the env var and stubs `globalThis.fetch`, restoring both after.

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/routes/clienti.test.ts`
Expected: FAIL — `/lookup/...` returns 404 (no route) instead of 200/503/400.

- [ ] **Step 3: Write minimal implementation**

Replace the trailing comment in `clienti.ts` with:

```ts
// ─────────── GET /lookup/:piva ───────────
clientiRoute.get('/lookup/:piva', async (c) => {
  const piva = c.req.param('piva');
  const apiKey = process.env.OPENAPI_COMPANY_KEY;
  const result = await lookupPartitaIva(piva, { apiKey });
  if (result.ok) return c.json({ data: result.data ?? {} });
  switch (result.code) {
    case 'INVALID_PIVA':
      throw new HttpError(400, 'INVALID_PIVA', 'Partita IVA non valida (11 cifre)');
    case 'NO_KEY':
      throw new HttpError(503, 'AUTOFILL_UNAVAILABLE', 'Autofill non disponibile (chiave API assente)');
    case 'NOT_FOUND':
      throw new HttpError(404, 'PIVA_NOT_FOUND', 'Partita IVA non trovata');
    default:
      throw new HttpError(502, 'AUTOFILL_ERROR', 'Errore nel servizio di autofill');
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/routes/clienti.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/clienti.ts src/server/routes/clienti.test.ts
git commit -m "feat(clienti): GET /lookup/:piva con env key + degrado 503"
```

---

## Task 6: Mount route in server

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add import + mount**

In `src/server/index.ts`, add the import alongside the others (after `pagamentiRoute`):

```ts
import { clientiRoute } from './routes/clienti';
```

And the mount alongside the others (after `app.route('/api/pagamenti', pagamentiRoute);`):

```ts
app.route('/api/clienti', clientiRoute);
```

- [ ] **Step 2: Verify the server typechecks and full suite is green**

Run: `npx tsc -p tsconfig.server.json --noEmit && npm test`
Expected: typecheck clean; all tests pass (194 existing + new validators/schemas/piva-lookup/clienti).

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(clienti): mount /api/clienti"
```

---

## Task 7: Client `api.ts` — add `patch` / `del`

**Files:**
- Modify: `src/client/lib/api.ts`

- [ ] **Step 1: Extend the `api` object**

Replace the `export const api = {...}` block in `src/client/lib/api.ts` with:

```ts
export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat(client): api.patch + api.del"
```

---

## Task 8: Typed `clienti-api.ts` client

**Files:**
- Create: `src/client/lib/clienti-api.ts`

- [ ] **Step 1: Write the client**

```ts
// src/client/lib/clienti-api.ts
import { api } from './api';
import type { ClientePublic, ClienteCreateInput, ClienteUpdateInput, PivaLookupData } from '@shared/types';

export function listClienti(): Promise<ClientePublic[]> {
  return api.get<ClientePublic[]>('/api/clienti');
}

export function createCliente(input: ClienteCreateInput): Promise<ClientePublic> {
  return api.post<ClientePublic>('/api/clienti', input);
}

export function updateCliente(id: string, input: ClienteUpdateInput): Promise<ClientePublic> {
  return api.patch<ClientePublic>(`/api/clienti/${id}`, input);
}

export function removeCliente(id: string): Promise<{ ok: true }> {
  return api.del<{ ok: true }>(`/api/clienti/${id}`);
}

export function setDefault(id: string): Promise<ClientePublic> {
  return api.patch<ClientePublic>(`/api/clienti/${id}`, { isDefault: true });
}

export function lookupPiva(piva: string): Promise<{ data: PivaLookupData }> {
  return api.get<{ data: PivaLookupData }>(`/api/clienti/lookup/${encodeURIComponent(piva)}`);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean. (`ClienteCreateInput` carries Zod input types — passing a partial object to `updateCliente` is fine since `ClienteUpdateInput` is the `.partial()` type.)

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/clienti-api.ts
git commit -m "feat(client): clienti-api tipizzato (list/create/update/remove/setDefault/lookup)"
```

---

## Task 9: Reusable modal component

Vanilla, ~50 lines. ESC + backdrop click close, basic focus trap, returns handle. Reused by 4C/4E.

**Files:**
- Create: `src/client/components/modal.ts`

- [ ] **Step 1: Write the component**

```ts
// src/client/components/modal.ts
//
// Modal vanilla riusabile (dark theme tokens). Nessun framework.
// openModal({title, bodyHtml, onMount}) → { close, root }.
// - ESC e click sul backdrop chiudono.
// - Focus-trap basilare (Tab/Shift+Tab ciclano dentro al dialog).
// - onMount(root, close) per cablare il contenuto dopo l'inserimento nel DOM.

interface ModalOpts {
  title: string;
  bodyHtml: string;
  onMount?: (root: HTMLElement, close: () => void) => void;
}

export function openModal(opts: ModalOpts): { close: () => void; root: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;' +
    'justify-content:center;z-index:1000;padding:var(--space-4);';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog card';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.style.cssText =
    'background:var(--surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);' +
    'box-shadow:var(--shadow-modal);max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:var(--space-5);';
  dialog.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
      <h3 style="margin:0;">${opts.title}</h3>
      <button type="button" class="btn btn-ghost" data-modal-close aria-label="Chiudi">✕</button>
    </div>
    <div data-modal-body>${opts.bodyHtml}</div>
  `;
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const prevActive = document.activeElement as HTMLElement | null;

  function close(): void {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
  }

  function focusable(): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ));
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const els = focusable();
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  dialog.querySelector<HTMLElement>('[data-modal-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const body = dialog.querySelector<HTMLElement>('[data-modal-body]')!;
  opts.onMount?.(body, close);
  focusable()[0]?.focus();

  return { close, root: body };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/modal.ts
git commit -m "feat(client): componente modal vanilla riusabile (ESC/backdrop/focus-trap)"
```

---

## Task 10: Page `/clienti`

Pattern `pages/profiles.ts`. List + client-side search + modal CRUD + autofill (merge into empty fields only) + ★ default toggle. Escape all user values.

**Files:**
- Create: `src/client/pages/clienti.ts`

- [ ] **Step 1: Write the page**

```ts
// src/client/pages/clienti.ts
import { getMe } from '../lib/auth';
import { ApiError } from '../lib/api';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';
import { openModal } from '../components/modal';
import {
  listClienti, createCliente, updateCliente, removeCliente, lookupPiva,
} from '../lib/clienti-api';
import type { ClientePublic, TipoCliente } from '@shared/types';

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
}

const TIPI: TipoCliente[] = ['PF', 'PG', 'PA', 'Estero'];

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;
  let clienti: ClientePublic[] = [];
  let filter = '';

  function matches(c: ClientePublic): boolean {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return [c.nome, c.partitaIva, c.citta].some((f) => (f ?? '').toLowerCase().includes(q));
  }

  function rowHtml(c: ClientePublic): string {
    const star = c.isDefault ? '★ ' : '';
    const sub = [c.partitaIva, c.citta].filter(Boolean).map(esc).join(' · ');
    return `
      <li data-id="${esc(c.id)}" class="cliente-row"
          style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3);
                 background:var(--bg);border-radius:var(--radius-md);cursor:pointer;">
        <span><strong>${star}${esc(c.nome)}</strong>
          <span style="color:var(--text-muted);">${sub}</span></span>
      </li>`;
  }

  function formHtml(c: Partial<ClientePublic>): string {
    const opt = (t: TipoCliente) => `<option value="${t}"${c.tipoCliente === t ? ' selected' : ''}>${t}</option>`;
    return `
      <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
        <div class="form-row"><label>Nome *</label>
          <input class="input" name="nome" required maxlength="200" value="${esc(c.nome)}" /></div>
        <div class="form-row"><label>Tipo</label>
          <select class="input" name="tipoCliente">${TIPI.map(opt).join('')}</select></div>
        <div class="form-row"><label>Partita IVA</label>
          <div style="display:flex;gap:var(--space-2);">
            <input class="input" name="partitaIva" maxlength="11" value="${esc(c.partitaIva)}" />
            <button type="button" class="btn btn-ghost" data-autofill>Autofill</button>
          </div></div>
        <div class="form-row"><label>Codice Fiscale</label>
          <input class="input" name="codiceFiscale" maxlength="16" value="${esc(c.codiceFiscale)}" /></div>
        <div class="form-row"><label data-sdi-label>Codice SDI</label>
          <input class="input" name="codiceSdi" maxlength="7" value="${esc(c.codiceSdi)}" /></div>
        <div class="form-row"><label>PEC</label>
          <input class="input" name="pec" value="${esc(c.pec)}" /></div>
        <div class="form-row"><label>Indirizzo</label>
          <input class="input" name="indirizzo" value="${esc(c.indirizzo)}" /></div>
        <div style="display:flex;gap:var(--space-2);">
          <div class="form-row" style="flex:0 0 90px;"><label>CAP</label>
            <input class="input" name="cap" maxlength="5" value="${esc(c.cap)}" /></div>
          <div class="form-row" style="flex:1;"><label>Città</label>
            <input class="input" name="citta" value="${esc(c.citta)}" /></div>
          <div class="form-row" style="flex:0 0 70px;"><label>Prov</label>
            <input class="input" name="provincia" maxlength="2" value="${esc(c.provincia)}" /></div>
        </div>
        <div class="form-row"><label>Nazione</label>
          <input class="input" name="nazione" maxlength="2" value="${esc(c.nazione ?? 'IT')}" /></div>
        <label style="display:flex;gap:var(--space-2);align-items:center;">
          <input type="checkbox" name="isDefault"${c.isDefault ? ' checked' : ''} /> Cliente predefinito</label>
        <p class="form-error" data-error hidden></p>
        <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
          <button type="submit" class="btn btn-primary">Salva</button>
          ${c.id ? `<button type="button" class="btn btn-ghost" data-delete style="color:var(--red);">Elimina</button>` : ''}
        </div>
      </form>`;
  }

  function readForm(form: HTMLFormElement): Record<string, unknown> {
    const fd = new FormData(form);
    const str = (k: string) => { const v = String(fd.get(k) ?? '').trim(); return v === '' ? null : v; };
    return {
      nome: str('nome'),
      tipoCliente: str('tipoCliente') ?? 'PG',
      partitaIva: str('partitaIva'),
      codiceFiscale: str('codiceFiscale'),
      codiceSdi: str('codiceSdi') ?? '0000000',
      pec: str('pec'),
      indirizzo: str('indirizzo'),
      cap: str('cap'),
      citta: str('citta'),
      provincia: str('provincia'),
      nazione: str('nazione') ?? 'IT',
      isDefault: fd.get('isDefault') === 'on',
    };
  }

  function openClienteModal(existing?: ClientePublic): void {
    openModal({
      title: existing ? 'Modifica cliente' : 'Nuovo cliente',
      bodyHtml: formHtml(existing ?? {}),
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        const sdiInput = form.querySelector<HTMLInputElement>('[name="codiceSdi"]')!;
        const sdiLabel = form.querySelector<HTMLElement>('[data-sdi-label]')!;
        const tipoSel = form.querySelector<HTMLSelectElement>('[name="tipoCliente"]')!;

        const syncSdi = () => {
          const isPa = tipoSel.value === 'PA';
          sdiInput.maxLength = isPa ? 6 : 7;
          sdiLabel.textContent = isPa ? 'Codice IPA (6)' : 'Codice SDI (7)';
        };
        tipoSel.addEventListener('change', syncSdi);
        syncSdi();

        form.querySelector<HTMLButtonElement>('[data-autofill]')?.addEventListener('click', async () => {
          const piva = form.querySelector<HTMLInputElement>('[name="partitaIva"]')!.value.trim();
          errorEl.hidden = true;
          try {
            const { data } = await lookupPiva(piva);
            // merge SOLO nei campi vuoti — non sovrascrive l'input utente.
            for (const [k, v] of Object.entries(data)) {
              if (!v) continue;
              const input = form.querySelector<HTMLInputElement>(`[name="${k}"]`);
              if (input && input.value.trim() === '') input.value = String(v);
            }
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Autofill non disponibile';
            errorEl.hidden = false;
          }
        });

        form.querySelector<HTMLButtonElement>('[data-delete]')?.addEventListener('click', async () => {
          if (!existing || !confirm(`Eliminare il cliente "${existing.nome}"?`)) return;
          await removeCliente(existing.id);
          close();
          await refresh();
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          const payload = readForm(form);
          try {
            if (existing) await updateCliente(existing.id, payload);
            else await createCliente(payload as never);
            close();
            await refresh();
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
    const visible = clienti.filter(matches);
    ul.innerHTML = visible.length
      ? visible.map(rowHtml).join('')
      : `<li style="color:var(--text-muted);padding:var(--space-3);">Nessun cliente.</li>`;
    ul.querySelectorAll<HTMLElement>('.cliente-row').forEach((li) => {
      li.addEventListener('click', () => {
        const c = clienti.find((x) => x.id === li.dataset.id);
        if (c) openClienteModal(c);
      });
    });
  }

  async function refresh(): Promise<void> {
    clienti = await listClienti();
    renderList();
  }

  async function render(): Promise<void> {
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
            <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
              <h2 style="margin:0;">Clienti</h2>
              <button class="btn btn-primary" data-new>Nuovo</button>
            </div>
            <input class="input" data-search placeholder="Cerca per nome, P.IVA, città…" style="margin-bottom:var(--space-4);" />
            <ul data-list style="list-style:none;display:flex;flex-direction:column;gap:var(--space-3);"></ul>
          </div>
        </main>
        ${renderBottomNav()}
      </div>`;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);

    container.querySelector<HTMLButtonElement>('[data-new]')?.addEventListener('click', () => openClienteModal());
    container.querySelector<HTMLInputElement>('[data-search]')?.addEventListener('input', (e) => {
      filter = (e.target as HTMLInputElement).value;
      renderList();
    });
    await refresh();
  }

  render();
  return () => { if (cleanupHeader) cleanupHeader(); };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean. (`createCliente(payload as never)` sidesteps the Zod-input vs runtime-object mismatch; the server re-validates everything.)

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/clienti.ts
git commit -m "feat(client): pagina /clienti (lista+ricerca+modal CRUD+autofill+default)"
```

---

## Task 11: Navigation — bottom-nav entry + route

**Files:**
- Modify: `src/client/components/bottom-nav.ts`
- Modify: `src/client/main.ts`

- [ ] **Step 1: Add nav entry**

In `src/client/components/bottom-nav.ts`, add a Clienti tab as the first item (enabled, with `data-route`):

```ts
export function renderBottomNav(): string {
  return `
    <nav class="bottom-nav">
      <a class="tab" data-route="/clienti" href="/clienti">👥 Clienti</a>
      <a class="tab" aria-disabled="true">📄 Fatture</a>
      <a class="tab" aria-disabled="true">⏳ Scadenze</a>
      <a class="tab" aria-disabled="true">📊 Dichiarazione</a>
    </nav>
  `;
}
```

- [ ] **Step 2: Register the route**

In `src/client/main.ts`, add to the `routes` record:

```ts
  // @ts-ignore — pages/clienti.ts created in Slice 4A
  '/clienti': () => import('./pages/clienti'),
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: typecheck clean; Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/bottom-nav.ts src/client/main.ts
git commit -m "feat(client): voce nav Clienti + route /clienti"
```

---

## Task 12: Smoke test (Playwright) extension

Extend `scripts/smoke-playwright.mjs`: login → open `/clienti` → create cliente → appears in list → set default. **First read the existing script** to match its login/setup helpers and assertion style exactly — do not restructure it.

**Files:**
- Modify: `scripts/smoke-playwright.mjs`

- [ ] **Step 1: Read the existing smoke script**

Run: open `scripts/smoke-playwright.mjs` and identify: how it launches the server/app, how it logs in, and where scenarios are appended. Reuse those helpers.

- [ ] **Step 2: Append the Clienti scenario**

Add, in the existing script's style (this is a template — adapt selectors/helpers to the file's actual conventions):

```js
// --- Clienti smoke (Slice 4A) ---
await page.goto(`${BASE}/clienti`);
await page.click('[data-new]');
await page.fill('[name="nome"]', 'Smoke Client Srl');
await page.fill('[name="partitaIva"]', '00743110157');
await page.click('[data-form] button[type="submit"]');
await page.waitForSelector('text=Smoke Client Srl');
console.log('✓ cliente creato e visibile in lista');

// set default: riapri e spunta predefinito
await page.click('text=Smoke Client Srl');
await page.check('[name="isDefault"]');
await page.click('[data-form] button[type="submit"]');
await page.waitForSelector('text=★ Smoke Client Srl');
console.log('✓ cliente impostato come default');
```

- [ ] **Step 3: Run the smoke test**

Run: the project's smoke command (check `package.json` — likely `npm run smoke` or `node scripts/smoke-playwright.mjs`). Ensure the dev server / built app is up as the existing script expects.
Expected: both new `✓` lines print; script exits 0.

> If autofill is exercised in smoke, run **without** `OPENAPI_COMPANY_KEY` so the `503` degradation path is what's hit — the manual insert must still succeed.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-playwright.mjs
git commit -m "test(clienti): smoke Playwright crea cliente + set default"
```

---

## Task 13: Docs + final verification

**Files:**
- Modify: `docs/migration-plan.md` (tick the Clienti phase)
- Verify: `docs/data-model.md` unchanged (no schema change in 4A)

- [ ] **Step 1: Update migration-plan**

Open `docs/migration-plan.md`, find the Clienti phase (Fase 4 per the spec), and mark it done with a one-line note: importer-independent CRUD + autofill + frontend page landed in Slice 4A. Match the existing checkmark/format style used for prior phases.

- [ ] **Step 2: Full suite + typecheck + build, all green**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.server.json --noEmit && npm run build`
Expected: all tests pass (194 existing + new), both typechecks clean, build succeeds. Capture the test count to confirm no regressions.

- [ ] **Step 3: Commit**

```bash
git add docs/migration-plan.md
git commit -m "docs(migration-plan): Fase Clienti completata (Slice 4A)"
```

- [ ] **Step 4: Definition of Done check** (from spec §13)

Confirm each: CRUD scoped + server validation (P.IVA check-digit) ✓; 409 duplicate + single-default tx ✓; `/lookup/:piva` + 503 degrade ✓; `/clienti` page list+search+modal CRUD+autofill+default on reusable `modal.ts` ✓; `api.ts` patch/del + nav + route ✓; test suite green (validators + piva-lookup + route + smoke) ✓; data-model unchanged ✓.

---

## Notes for the executor

- **Run from repo root** (`C:\Users\matti\Documents\Progetti\Lira\Lira`). Shell is PowerShell; the `npm`/`npx` commands above are shell-agnostic.
- **Test runner:** confirm the exact invocation from `package.json` `scripts.test` (the plan uses `npm test -- <file>`; if the project filters tests differently, adapt — but every task must run its own test in isolation before the full suite).
- **`noUncheckedIndexedAccess`:** always non-null-assert (`arr[0]!`) or guard after `.find()`/index access. The provided code already does this.
- **No new dependencies.** Everything uses Hono, Drizzle, Zod, and DOM APIs already in the project.
- **Env for live autofill:** real `OPENAPI_COMPANY_KEY` is supplied by the user out-of-band for live testing; all automated tests inject `fetchImpl`/stub `globalThis.fetch`. Never hardcode the key (CalcoliVari's hardcoded key must not be carried over — see CLAUDE.md "Niente legacy carry-over").
