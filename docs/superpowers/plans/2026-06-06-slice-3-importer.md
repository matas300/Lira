# Slice 3 — Importer CalcoliVari → Lira — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importer ri-eseguibile che legge gli export di CalcoliVari (formato ufficiale + backup-wrapper) e popola il DB Lira per tutte le 9 entità, idempotente, dry-run-first, con merge longest-wins.

**Architecture:** Pipeline di funzioni **pure** in `src/server/lib/import-calcolivari/` (`detect → extract → map+Zod → merge → plan/diff → apply`); CLI sottile in `scripts/import-from-calcolivari.ts` (già wired come `npm run import:legacy`). `plan`/`apply` ricevono `db` (DI, come le altre lib). Dry-run di default; `--commit` scrive in transazione previo snapshot.

**Tech Stack:** TypeScript strict, Drizzle (libSQL), Zod, `node:test` + `tsx`, `node:crypto` (id deterministici), libsql file-temp per test DB (`createTestDb`).

**Spec di riferimento:** `docs/superpowers/specs/2026-06-06-slice-3-importer-design.md` (commit `259442d`).

**Nota di semplificazione vs spec §3:** gli estrattori/mapper sono consolidati in `extract.ts`/`map.ts` (file focalizzati ~150 righe) invece di una sub-cartella per-entità: meno sprawl, stessa testabilità. `plan`/`apply` sono generici, guidati da un registry di entità.

---

## File map

**Created (`src/server/lib/import-calcolivari/`):**
- `types.ts` — interfacce condivise
- `errors.ts` — `ImportError`
- `identity.ts` (+ `.test.ts`) — `det()`, `newId()`
- `normalize.ts` (+ `.test.ts`) — `ns/nn/nb/pctToFrac`
- `detect.ts` (+ `.test.ts`) — formato → `RawExport`
- `extract.ts` (+ `.test.ts`) — tutti gli estrattori → `ExtractedData`
- `schemas.ts` — Zod row-schemas
- `map.ts` (+ `.test.ts`) — `ExtractedData` → `MappedRows` (Zod, issues)
- `registry.ts` — `CHILD_ENTITIES: EntitySpec[]`
- `plan.ts` (+ `.test.ts`) — `buildImportPlan`
- `apply.ts` (+ `.test.ts`) — snapshot + `applyImportPlan`
- `index.ts` — re-export pubblici

**Created (altri):**
- `scripts/import-from-calcolivari.ts` (+ `scripts/import-from-calcolivari.test.ts`) — CLI
- `src/test-fixtures/calcolivari-sample.ts` — export sintetico (ufficiale + wrapper)
- `src/server/lib/import-calcolivari/e2e.test.ts` — end-to-end su `createTestDb`

**Modified:**
- `docs/migration-plan.md` (Fase 9: importer ✅)

---

## Task 1 — `types.ts` + `errors.ts` + `identity.ts`

**Files:**
- Create: `src/server/lib/import-calcolivari/types.ts`, `errors.ts`, `identity.ts`
- Test: `src/server/lib/import-calcolivari/identity.test.ts`

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/identity.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { det, newId } from './identity';

test('det: deterministico e stabile per stessi input', () => {
  const a = det('pagamento', 'p1', '2025-06-30', 1000, 'tasse', null);
  const b = det('pagamento', 'p1', '2025-06-30', 1000, 'tasse', null);
  assert.equal(a, b);
});

test('det: cambia se cambia un input', () => {
  assert.notEqual(det('p1', 1000), det('p1', 1001));
});

test('det: formato UUID-shaped (8-4-4-4-12 hex)', () => {
  assert.match(det('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('det: null/undefined trattati come stringa vuota (stesso hash)', () => {
  assert.equal(det('a', null, 'b'), det('a', undefined, 'b'));
});

test('newId: UUID v4 unico', () => {
  assert.notEqual(newId(), newId());
  assert.match(newId(), /^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 2: Run → FAIL** — `npm test -- --test-name-pattern "det:"` → `Cannot find module './identity'`.

- [ ] **Step 3: Implementare**

`src/server/lib/import-calcolivari/identity.ts`:
```ts
import { createHash, randomUUID } from 'node:crypto';

/**
 * Id deterministico da una firma naturale: SHA-256 dei `parts` formattato
 * come UUID. Stessi input → stesso id → import idempotente. null/undefined
 * normalizzati a stringa vuota.
 */
export function det(...parts: Array<string | number | null | undefined>): string {
  const hex = createHash('sha256')
    .update(parts.map((p) => (p ?? '').toString()).join('|'))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function newId(): string {
  return randomUUID();
}
```

`src/server/lib/import-calcolivari/errors.ts`:
```ts
export class ImportError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
```

`src/server/lib/import-calcolivari/types.ts`:
```ts
import type { profiles, yearSettings, clienti, fatture, pagamenti, calendarEntries, budgetItems, spese, dichiarazioni } from '../../db/schema';

export interface RawExport {
  profileName: string;
  keys: Record<string, unknown>;
}

export interface YearDoc {
  year: number;
  data: Record<string, any>;
}

export interface ExtractedData {
  profileName: string;
  anagrafica: Record<string, any>;
  attivita: Record<string, any>;
  fiscal: Record<string, any>;
  regime: string | null;
  displayName: string | null;
  giorniIncasso: number;
  yearSettings: Array<{ year: number; settings: Record<string, any> }>;
  clienti: Array<Record<string, any>>;
  clienteDefaultId: string | null;
  fatture: Array<Record<string, any>>;
  pagamenti: Array<{ year: number } & Record<string, any>>;
  calendar: Array<{ year: number; month: number; day: number; code: string }>;
  budget: Array<{ year: number; nome: any; importo: any; auto: any; ordine: number }>;
  spese: Array<{ year: number } & Record<string, any>>;
  dichiarazioni: Array<{ year: number; dichiarazione: Record<string, any> }>;
}

export interface ImportIssue {
  entity: string;
  sourceKey: string;
  reason: string;
}

export type ProfileRow = typeof profiles.$inferInsert;
export type YearSettingsRow = typeof yearSettings.$inferInsert;
export type ClienteRow = typeof clienti.$inferInsert;
export type FatturaRow = typeof fatture.$inferInsert;
export type PagamentoRow = typeof pagamenti.$inferInsert;
export type CalendarRow = typeof calendarEntries.$inferInsert;
export type BudgetRow = typeof budgetItems.$inferInsert;
export type SpesaRow = typeof spese.$inferInsert;
export type DichiarazioneRow = typeof dichiarazioni.$inferInsert;

export interface MappedRows {
  profiles: ProfileRow[];
  yearSettings: YearSettingsRow[];
  clienti: ClienteRow[];
  fatture: FatturaRow[];
  pagamenti: PagamentoRow[];
  calendarEntries: CalendarRow[];
  budgetItems: BudgetRow[];
  spese: SpesaRow[];
  dichiarazioni: DichiarazioneRow[];
}

export type ChildEntityName = Exclude<keyof MappedRows, 'profiles'>;

export interface EntityPlan {
  entity: string;
  inserts: any[];
  updates: any[];
  identical: number;
}

export type ProfileOp = 'insert' | 'update' | 'identical';

export interface ImportPlan {
  profileName: string;
  userId: string;
  profileId: string;
  slug: string;
  profileOp: ProfileOp;
  profileRow: ProfileRow;
  entities: Record<string, EntityPlan>;
  issues: ImportIssue[];
}
```

- [ ] **Step 4: Run → PASS** — `npm test -- --test-name-pattern "det:|newId:"`.

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/types.ts src/server/lib/import-calcolivari/errors.ts src/server/lib/import-calcolivari/identity.ts src/server/lib/import-calcolivari/identity.test.ts
git commit -m "feat(import): types, ImportError e id deterministici (det/newId)"
```

---

## Task 2 — `normalize.ts`

**Files:**
- Create: `src/server/lib/import-calcolivari/normalize.ts`
- Test: `src/server/lib/import-calcolivari/normalize.test.ts`

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/normalize.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ns, nn, nb, pctToFrac } from './normalize';

test('ns: trim, vuoto → null', () => {
  assert.equal(ns('  ciao '), 'ciao');
  assert.equal(ns(''), null);
  assert.equal(ns('   '), null);
  assert.equal(ns(null), null);
  assert.equal(ns(undefined), null);
});

test('nn: numerico, vuoto/non-numerico → null', () => {
  assert.equal(nn(10), 10);
  assert.equal(nn('10.5'), 10.5);
  assert.equal(nn(''), null);
  assert.equal(nn('abc'), null);
  assert.equal(nn(null), null);
});

test('nb: bool-ish → 0/1', () => {
  for (const v of [true, 1, '1']) assert.equal(nb(v), 1);
  for (const v of [false, 0, '0', '', null, undefined]) assert.equal(nb(v), 0);
});

test('pctToFrac: percentuale → frazione (>1 ⇒ /100)', () => {
  assert.equal(pctToFrac(67), 0.67);
  assert.equal(pctToFrac(15), 0.15);
  assert.equal(pctToFrac(0.67), 0.67); // già frazione
  assert.equal(pctToFrac(''), null);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/lib/import-calcolivari/normalize.ts`:
```ts
/** Stringa trimmata, vuoto/null → null. */
export function ns(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** Numero finito, vuoto/non-numerico → null. */
export function nn(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** Booleano CalcoliVari → 0/1. */
export function nb(v: unknown): number {
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

/** Percentuale CalcoliVari (es. 67, 15) → frazione Lira (0.67, 0.15). */
export function pctToFrac(v: unknown): number | null {
  const x = nn(v);
  if (x == null) return null;
  return x > 1 ? x / 100 : x;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/normalize.ts src/server/lib/import-calcolivari/normalize.test.ts
git commit -m "feat(import): helper di normalizzazione (ns/nn/nb/pctToFrac)"
```

---

## Task 3 — `detect.ts`

**Files:**
- Create: `src/server/lib/import-calcolivari/detect.ts`
- Test: `src/server/lib/import-calcolivari/detect.test.ts`

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/detect.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from './detect';

test('detect: export ufficiale flat → profileName da prefisso', () => {
  const r = detect({
    'calcoliPIVA_Mattia_2025': { settings: {} },
    'calcoliPIVA_Mattia_clienti': [],
    'calcoliPIVA_profile_Mattia': { nome: 'M' },
  });
  assert.equal(r.profileName, 'Mattia');
  assert.deepEqual(r.keys['calcoliPIVA_Mattia_2025'], { settings: {} });
});

test('detect: profileName anche se ci sono solo year-data', () => {
  const r = detect({ 'calcoliPIVA_Peru_2024': { settings: {} } });
  assert.equal(r.profileName, 'Peru');
});

test('detect: backup-wrapper → unwrap + ri-parse stringhe', () => {
  const r = detect({
    profile: 'Mattia',
    timestamp: '2026-05-25T00:00:00Z',
    keys: { 'calcoliPIVA_Mattia_2025': '{"settings":{"regime":"forfettario"}}' },
  });
  assert.equal(r.profileName, 'Mattia');
  assert.deepEqual(r.keys['calcoliPIVA_Mattia_2025'], { settings: { regime: 'forfettario' } });
});

test('detect: keys globali non confondono il profileName', () => {
  const r = detect({
    'calcoliPIVA_activeTab': 'home',
    'calcoliPIVA_Mattia_2025': { settings: {} },
  });
  assert.equal(r.profileName, 'Mattia');
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/lib/import-calcolivari/detect.ts`:
```ts
import type { RawExport } from './types';
import { ImportError } from './errors';

/** Riconosce export ufficiale vs backup-wrapper e produce una forma uniforme. */
export function detect(input: unknown): RawExport {
  if (input && typeof input === 'object' && 'keys' in input && 'profile' in input) {
    const w = input as { profile: string; keys: Record<string, unknown> };
    const keys: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(w.keys)) {
      keys[k] = typeof v === 'string' ? JSON.parse(v) : v;
    }
    return { profileName: String(w.profile), keys };
  }
  const keys = (input ?? {}) as Record<string, unknown>;
  return { profileName: deriveProfileName(keys), keys };
}

function deriveProfileName(keys: Record<string, unknown>): string {
  for (const k of Object.keys(keys)) {
    const m = /^calcoliPIVA_profile_(.+)$/.exec(k);
    if (m) return m[1]!;
  }
  for (const k of Object.keys(keys)) {
    const m = /^calcoliPIVA_(.+?)_/.exec(k);
    if (m && m[1] !== 'profile') return m[1]!;
  }
  throw new ImportError('PROFILE_NAME_UNDERIVABLE', 'Impossibile derivare il nome profilo dalle chiavi export.');
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/detect.ts src/server/lib/import-calcolivari/detect.test.ts
git commit -m "feat(import): detect formato (ufficiale + backup-wrapper) → RawExport"
```

---

## Task 4 — `extract.ts`

**Files:**
- Create: `src/server/lib/import-calcolivari/extract.ts`
- Test: `src/server/lib/import-calcolivari/extract.test.ts`
- Riferimento: spec §5 (mapping per entità), §2.5 (insidie).

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/extract.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from './detect';
import { extractAll } from './extract';

const SAMPLE = {
  'calcoliPIVA_Mattia_2024': {
    settings: { regime: 'forfettario', coefficiente: 67, anagrafica: { nome: 'Mattia', codiceFiscale: 'CF24' }, attivita: { partitaIva: 'IT123' } },
    pagamenti: [{ data: '2024-06-30', tipo: 'tasse', descrizione: 'saldo', importo: 500, scheduleKey: 'imposta_saldo_2023' }],
    budget: [{ nome: 'Tasse', importo: 1000, auto: true }],
    spese: [{ titolo: 'PC', costo: 800, deducibilita: 1, anni: 1 }],
    calendar: { '3-15': 'F', '6-1': '' },
    lmQuadro: { overrides: { LM_x: 5 } },
    _fattureManualeWipedBackup: { '5': [{ importo: 300, desc: 'vecchia', pagMese: 5, pagAnno: 2024 }] },
  },
  'calcoliPIVA_Mattia_2025': {
    settings: { regime: 'forfettario', coefficiente: 67, anagrafica: { cognome: 'Rossi' } },
    pagamenti: [{ data: '2025-06-30', tipo: 'tasse', importo: 900, scheduleKey: 'imposta_acc1_2025' }],
    dichiarazione: { tipoDichiarazione: 'ordinaria', overrides: { LM_y: 2 }, contiEsteri: [] },
  },
  'calcoliPIVA_Mattia_fattureEmesse': [
    { id: 'fat1', anno: 2025, annoProgressivo: 2025, progressivo: 7, numero: '7/2025', data: '2025-03-01', tipoDocumento: 'TD01', totaleLordo: 1500, righe: [{ descrizione: 'Dev', quantita: 1, prezzoUnitario: 1500, iva: 0 }], stato: 'pagata', origine: 'wizard' },
  ],
  'calcoliPIVA_Mattia_clienti': [{ id: 'cli1', nome: 'ACME', tipoCliente: 'PG', partitaIva: 'IT999' }],
  'calcoliPIVA_Mattia_clienteDefaultId': 'cli1',
  'calcoliPIVA_Mattia_giorniIncasso': 45,
  'calcoliPIVA_profile_Mattia': { nome: 'Mattia', partitaIva: 'IT123', ateco: '62.01.00' },
};

test('extractAll: anagrafica/attività merge multi-anno + fiscal', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.anagrafica.nome, 'Mattia');
  assert.equal(ex.anagrafica.cognome, 'Rossi'); // dal 2025
  assert.equal(ex.giorniIncasso, 45);
});

test('extractAll: pagamenti cross-year raccolti da tutti gli anni', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.pagamenti.length, 2);
  assert.deepEqual(ex.pagamenti.map((p) => p.year).sort(), [2024, 2025]);
});

test('extractAll: fattura canonica + legacy da _fattureManualeWipedBackup', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.fatture.length, 2);
  const legacy = ex.fatture.find((f) => f.origine === 'legacy-migrated');
  assert.ok(legacy);
  assert.equal(legacy!.importo, 300);
  assert.ok(legacy!.progressivo >= 9000);
});

test('extractAll: calendar sparso, code vuoto scartato', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.calendar.length, 1);
  assert.deepEqual(ex.calendar[0], { year: 2024, month: 3, day: 15, code: 'F' });
});

test('extractAll: lmQuadro legacy → dichiarazione overrides', () => {
  const ex = extractAll(detect(SAMPLE));
  const d2024 = ex.dichiarazioni.find((d) => d.year === 2024);
  assert.deepEqual(d2024!.dichiarazione.overrides, { LM_x: 5 });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/lib/import-calcolivari/extract.ts`:
```ts
import type { RawExport, YearDoc, ExtractedData } from './types';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yearDocs(keys: Record<string, unknown>, profile: string): YearDoc[] {
  const re = new RegExp(`^calcoliPIVA_${escapeRe(profile)}_(\\d{4})$`);
  const docs: YearDoc[] = [];
  for (const [k, v] of Object.entries(keys)) {
    const m = re.exec(k);
    if (m && v && typeof v === 'object') docs.push({ year: Number(m[1]), data: v as Record<string, any> });
  }
  return docs.sort((a, b) => a.year - b.year);
}

function keyFor(keys: Record<string, unknown>, profile: string, suffix: string): unknown {
  return keys[`calcoliPIVA_${profile}_${suffix}`];
}

function mergeFirstNonEmpty(objs: Array<Record<string, any> | null | undefined>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o)) {
      if ((out[k] == null || out[k] === '') && v != null && String(v).trim() !== '') out[k] = v;
    }
  }
  return out;
}

export function extractAll(exp: RawExport): ExtractedData {
  const { profileName: p, keys } = exp;
  const docs = yearDocs(keys, p);
  const fiscal = (keys[`calcoliPIVA_profile_${p}`] as Record<string, any>) ?? {};

  const anagrafica = mergeFirstNonEmpty(docs.map((d) => d.data?.settings?.anagrafica));
  const attivita = mergeFirstNonEmpty(docs.map((d) => d.data?.settings?.attivita));
  const regime = mergeFirstNonEmpty(docs.map((d) => d.data?.settings)).regime ?? null;
  const displayName = (fiscal.nome as string) ?? [anagrafica.nome, anagrafica.cognome].filter(Boolean).join(' ') ?? null;

  const clienti = (keyFor(keys, p, 'clienti') as any[]) ?? [];
  const clienteDefaultId = (keyFor(keys, p, 'clienteDefaultId') as string) ?? null;
  const giorniIncasso = Number(keyFor(keys, p, 'giorniIncasso') ?? 30) || 30;

  // Fatture canoniche (profile-scoped) + legacy non migrate (year-scoped).
  const canon = ((keyFor(keys, p, 'fattureEmesse') as any[]) ?? []).map((f) => ({ ...f }));
  const legacy: Array<Record<string, any>> = [];
  for (const doc of docs) {
    const wiped = doc.data?._fattureManualeWipedBackup ?? doc.data?.fatture ?? {};
    let idx = 0;
    for (const arr of Object.values(wiped)) {
      for (const row of (Array.isArray(arr) ? arr : [])) {
        if (row && typeof row === 'object' && !(row as any).invoiceId) {
          const importo = (row as any).importo;
          legacy.push({
            origine: 'legacy-migrated',
            stato: 'bozza',
            annoProgressivo: doc.year,
            progressivo: 9000 + idx++,
            importo,
            pagMese: (row as any).pagMese ?? null,
            pagAnno: (row as any).pagAnno ?? null,
            righe: [{ descrizione: (row as any).desc ?? 'legacy', quantita: 1, prezzoUnitario: importo, iva: 0 }],
          });
        }
      }
    }
  }

  const pagamenti = docs.flatMap((d) => ((d.data?.pagamenti as any[]) ?? []).map((pg) => ({ ...pg, year: d.year })));

  const calendar = docs.flatMap((d) =>
    Object.entries((d.data?.calendar as Record<string, string>) ?? {})
      .filter(([, code]) => code && String(code).trim() !== '')
      .map(([md, code]) => {
        const [mo, da] = md.split('-');
        return { year: d.year, month: Number(mo), day: Number(da), code: String(code) };
      }),
  );

  const budget = docs.flatMap((d) =>
    ((d.data?.budget as any[]) ?? []).map((b, i) => ({ year: d.year, nome: b?.nome, importo: b?.importo, auto: b?.auto, ordine: i })),
  );

  const spese = docs.flatMap((d) => ((d.data?.spese as any[]) ?? []).map((s) => ({ ...s, year: d.year })));

  const dichiarazioni = docs
    .map((d) => {
      const dich = d.data?.dichiarazione ?? (d.data?.lmQuadro ? { overrides: d.data.lmQuadro.overrides ?? {} } : null);
      return dich ? { year: d.year, dichiarazione: dich as Record<string, any> } : null;
    })
    .filter((x): x is { year: number; dichiarazione: Record<string, any> } => x != null);

  const yearSettings = docs.map((d) => ({ year: d.year, settings: (d.data?.settings as Record<string, any>) ?? {} }));

  return {
    profileName: p, anagrafica, attivita, fiscal, regime, displayName, giorniIncasso,
    yearSettings, clienti, clienteDefaultId,
    fatture: [...canon, ...legacy], pagamenti, calendar, budget, spese, dichiarazioni,
  };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/extract.ts src/server/lib/import-calcolivari/extract.test.ts
git commit -m "feat(import): estrattori per 9 entità (cross-year pagamenti, legacy fatture, lmQuadro)"
```

---

## Task 5 — `schemas.ts` + `map.ts`

**Files:**
- Create: `src/server/lib/import-calcolivari/schemas.ts`, `map.ts`
- Test: `src/server/lib/import-calcolivari/map.test.ts`
- Riferimento: spec §5 (mapping), §6 (identità).

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/map.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from './detect';
import { extractAll } from './extract';
import { mapAll } from './map';

const CTX = { profileId: 'prof-1', userId: 'user-1', slug: 'mattia' };

function sample() {
  return {
    'calcoliPIVA_Mattia_2025': {
      settings: { regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata', limiteForfettario: 85000 },
      pagamenti: [{ data: '2025-06-30', tipo: 'tasse', importo: 900, scheduleKey: 'imposta_acc1_2025' }],
    },
    'calcoliPIVA_Mattia_clienti': [{ id: 'cli1', nome: 'ACME', partitaIva: 'IT999' }],
    'calcoliPIVA_Mattia_clienteDefaultId': 'cli1',
    'calcoliPIVA_Mattia_fattureEmesse': [
      { id: 'fat1', annoProgressivo: 2025, progressivo: 7, data: '2025-03-01', totaleLordo: 1500, righe: [{ descrizione: 'Dev', quantita: 1, prezzoUnitario: 1500, iva: 0 }], stato: 'pagata' },
    ],
    'calcoliPIVA_profile_Mattia': { nome: 'Mattia' },
  };
}

test('mapAll: year_settings normalizza coefficiente %→frazione', () => {
  const { rows, issues } = mapAll(extractAll(detect(sample())), CTX);
  assert.equal(issues.length, 0);
  const ys = rows.yearSettings[0]!;
  assert.equal(ys.coefficiente, 0.67);
  assert.equal(ys.impostaSostitutiva, 0.05);
  assert.equal(ys.profileId, 'prof-1');
});

test('mapAll: cliente riusa id CalcoliVari e setta is_default', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  assert.equal(rows.clienti[0]!.id, 'cli1');
  assert.equal(rows.clienti[0]!.isDefault, 1);
});

test('mapAll: pagamento id deterministico + year da scheduleKey', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  const p = rows.pagamenti[0]!;
  assert.equal(p.year, 2025);
  assert.match(p.id, /^[0-9a-f]{8}-/);
});

test('mapAll: fattura numero_display in convenzione Lira YYYY/NNN', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  assert.equal(rows.fatture[0]!.numeroDisplay, '2025/7');
  assert.equal(rows.fatture[0]!.importo, 1500);
});

test('mapAll: profilo con anagrafica/attività JSON valido', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  const prof = rows.profiles[0]!;
  assert.equal(prof.slug, 'mattia');
  assert.equal(JSON.parse(prof.anagrafica!).nome, 'Mattia');
});

test('mapAll: riga invalida → ImportIssue, non in rows', () => {
  const bad = { 'calcoliPIVA_Mattia_2025': { settings: { regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata' }, pagamenti: [{ data: '', tipo: '', importo: 'x' }] } };
  const { rows, issues } = mapAll(extractAll(detect(bad)), CTX);
  assert.equal(rows.pagamenti.length, 0);
  assert.ok(issues.some((i) => i.entity === 'pagamenti'));
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare schemi e mapper**

`src/server/lib/import-calcolivari/schemas.ts`:
```ts
import { z } from 'zod';
import { RegimeEnum, InpsModeEnum } from '@shared/schemas';

export const zProfile = z.object({ id: z.string().min(1), userId: z.string().min(1), slug: z.string().min(1), displayName: z.string().min(1) }).passthrough();
export const zYearSettings = z.object({ profileId: z.string().min(1), year: z.number().int().gte(2000).lte(2100), regime: RegimeEnum, coefficiente: z.number().gt(0).lte(1), impostaSostitutiva: z.number().gte(0).lte(1), inpsMode: InpsModeEnum }).passthrough();
export const zCliente = z.object({ id: z.string().min(1), profileId: z.string().min(1), nome: z.string().min(1) }).passthrough();
export const zFattura = z.object({ id: z.string().min(1), profileId: z.string().min(1), annoProgressivo: z.number().int(), progressivo: z.number().int(), data: z.string().min(1), importo: z.number() }).passthrough();
export const zPagamento = z.object({ id: z.string().min(1), profileId: z.string().min(1), year: z.number().int(), data: z.string().min(1), tipo: z.string().min(1), importo: z.number() }).passthrough();
export const zCalendar = z.object({ profileId: z.string().min(1), year: z.number().int(), month: z.number().int().gte(1).lte(12), day: z.number().int().gte(1).lte(31), activityCode: z.string().min(1) }).passthrough();
export const zBudget = z.object({ id: z.string().min(1), profileId: z.string().min(1), year: z.number().int(), nome: z.string().min(1), importo: z.number() }).passthrough();
export const zSpesa = z.object({ id: z.string().min(1), profileId: z.string().min(1), year: z.number().int(), titolo: z.string().min(1), costo: z.number(), deducibilita: z.number().gte(0).lte(1) }).passthrough();
export const zDichiarazione = z.object({ profileId: z.string().min(1), year: z.number().int(), tipo: z.string().min(1) }).passthrough();
```

`src/server/lib/import-calcolivari/map.ts`:
```ts
import type { z } from 'zod';
import type { ExtractedData, ImportIssue, MappedRows } from './types';
import { det } from './identity';
import { ns, nn, nb, pctToFrac } from './normalize';
import * as S from './schemas';

interface Ctx { profileId: string; userId: string; slug: string }

function yearFromScheduleKey(k?: string | null): number | null {
  if (!k) return null;
  const m = /(\d{4})(?:_\d+)?$/.exec(k);
  return m ? Number(m[1]) : null;
}
function yearFromIso(d?: string | null): number | null {
  if (!d) return null;
  const m = /^(\d{4})/.exec(d);
  return m ? Number(m[1]) : null;
}

function buildAnagrafica(a: Record<string, any>, f: Record<string, any>) {
  return {
    cf: ns(a.codiceFiscale ?? f.codiceFiscale), nome: ns(a.nome ?? f.nome), cognome: ns(a.cognome),
    sesso: ns(a.sesso), data_nascita: ns(a.dataNascita), comune_nascita: ns(a.comuneNascita), prov_nascita: ns(a.provNascita),
    residenza: { indirizzo: ns(a.residenzaVia ?? f.indirizzo), cap: ns(a.residenzaCap ?? f.cap), citta: ns(a.residenzaComune ?? f.citta), provincia: ns(a.residenzaProv ?? f.provincia) },
    domicilio_fiscale: { indirizzo: ns(a.domicilioFiscaleVia), cap: ns(a.domicilioFiscaleCap), citta: ns(a.domicilioFiscaleComune), provincia: ns(a.domicilioFiscaleProv) },
    telefono: ns(a.telefono), email: ns(a.email), iban: ns(a.iban ?? f.iban), modalita_pagamento: ns(a.modalitaPagamento ?? f.modalitaPagamento),
  };
}
function buildAttivita(at: Record<string, any>, f: Record<string, any>, regime: string | null) {
  return {
    partita_iva: ns(at.partitaIva ?? f.partitaIva), codice_ateco: ns(at.codiceAteco ?? f.ateco), ateco_gruppo: ns(at.atecoGruppo ?? f.atecoGruppo),
    descrizione_attivita: ns(at.descrizioneAttivita ?? f.atecoDescrizione), comune_domicilio: ns(at.sedeComune), data_inizio_attivita: ns(at.dataInizioAttivita),
    regime_default: ns(regime) ?? 'forfettario', agevolazione_startup: nb(at.agevolazioneStartUp ?? f.agevolazioneStartUp), primo_anno_agevolato: nb(at.primoAnnoAgevolato ?? f.primoAnnoAgevolato),
  };
}
function buildOverrides(s: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const k of ['scadenziarioSaldoImposta','scadenziarioAccontoImposta','scadenziarioSaldoContributi','scadenziarioAccontoContributi','scadenziarioDirittoCamerale','scadenziarioBolloPrecedenteQ4','scadenziarioBolloCorrenteQ4','scadenziarioInailCorrente','scadenziarioInailSuccessivo','scadenziarioOverrideDataSaldoImposta']) {
    const v = s[k]; if (v != null && v !== '') o[k] = v;
  }
  return o;
}
function mapRighe(righe: any): any[] {
  return (Array.isArray(righe) ? righe : []).map((r) => ({ descrizione: ns(r?.descrizione), quantita: nn(r?.quantita) ?? 1, prezzo_unitario: nn(r?.prezzoUnitario) ?? 0, iva: nn(r?.iva) ?? 0 }));
}

function validate<T>(schema: z.ZodTypeAny, row: T, entity: string, sourceKey: string, issues: ImportIssue[]): T | null {
  const r = schema.safeParse(row);
  if (r.success) return row;
  issues.push({ entity, sourceKey, reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  return null;
}

export function mapAll(ex: ExtractedData, ctx: Ctx): { rows: MappedRows; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const pid = ctx.profileId;

  const profileRow = {
    id: pid, userId: ctx.userId, slug: ctx.slug,
    displayName: ns(ex.displayName) ?? ctx.slug,
    anagrafica: JSON.stringify(buildAnagrafica(ex.anagrafica, ex.fiscal)),
    attivita: JSON.stringify(buildAttivita(ex.attivita, ex.fiscal, ex.regime)),
    giorniIncasso: ex.giorniIncasso,
  };
  const profiles = validate(S.zProfile, profileRow, 'profiles', ctx.slug, issues) ? [profileRow] : [];

  const yearSettings = ex.yearSettings.map((y) => {
    const s = y.settings;
    return {
      profileId: pid, year: y.year, regime: ns(s.regime) ?? 'forfettario',
      coefficiente: pctToFrac(s.coefficiente) ?? 0.67, impostaSostitutiva: pctToFrac(s.impostaSostitutiva) ?? 0.15,
      inpsMode: ns(s.inpsMode) ?? 'gestione_separata', inpsCategoria: ns(s.inpsCategoria),
      riduzione35: nb(s.riduzione35), haRedditoDipendente: nb(s.haRedditoDipendente),
      limiteForfettario: nn(s.limiteForfettario) ?? 85000, scadenziarioMetodo: ns(s.scadenziarioMetodoAcconti) ?? 'storico',
      primoAnnoFatturatoPrec: nn(s.primoAnnoFatturatoPrec), primoAnnoImpostaPrec: nn(s.primoAnnoImpostaPrec),
      primoAnnoAccontiImpostaPrec: nn(s.primoAnnoAccontiImpostaPrec), primoAnnoContribVariabiliPrec: nn(s.primoAnnoContribVariabiliPrec),
      primoAnnoAccontiContribPrec: nn(s.primoAnnoAccontiContribPrec), overrides: JSON.stringify(buildOverrides(s)),
    };
  }).filter((r) => validate(S.zYearSettings, r, 'yearSettings', `year ${r.year}`, issues));

  const clienti = ex.clienti.map((c) => ({
    id: ns(c.id) ?? det('cliente', pid, c.nome, c.partitaIva, c.codiceFiscale), profileId: pid,
    nome: ns(c.nome) ?? '(senza nome)', tipoCliente: ns(c.tipoCliente) ?? 'PG',
    partitaIva: ns(c.partitaIva), codiceFiscale: ns(c.codiceFiscale), codiceSdi: ns(c.codiceSDI) ?? '0000000',
    pec: ns(c.pec), indirizzo: ns(c.indirizzo), cap: ns(c.cap), citta: ns(c.citta), provincia: ns(c.provincia), nazione: ns(c.nazione) ?? 'IT',
    descrizioneStandard: ns(c.descrizioneStandard), isDefault: c.id && c.id === ex.clienteDefaultId ? 1 : 0, note: ns(c.note),
  })).filter((r) => validate(S.zCliente, r, 'clienti', String(r.id), issues));

  const fatture = ex.fatture.map((f) => {
    const anno = nn(f.annoProgressivo ?? f.anno) ?? 0;
    const prog = nn(f.progressivo) ?? 0;
    return {
      id: ns(f.id) ?? det('fattura', pid, anno, prog), profileId: pid, clienteId: ns(f.clienteId),
      tipoDocumento: ns(f.tipoDocumento) ?? 'TD01', annoProgressivo: anno, progressivo: prog, numeroDisplay: `${anno}/${prog}`,
      data: ns(f.data) ?? `${anno || 1970}-${String(nn(f.pagMese) ?? 1).padStart(2, '0')}-01`,
      clienteSnapshot: f.clienteSnapshot ? JSON.stringify(f.clienteSnapshot) : null, righe: JSON.stringify(mapRighe(f.righe)),
      importo: nn(f.totaleLordo ?? f.totaleDocument ?? f.totaleDocumento ?? f.importo) ?? 0,
      ritenuta: nn(f.ritenuta) ?? 0, aliquotaRitenuta: nn(f.aliquotaRitenuta), tipoRitenuta: ns(f.tipoRitenuta), causaleRitenuta: ns(f.causaleRitenuta),
      contributoIntegrativo: nn(f.contributoIntegrativo) ?? 0, marcaDaBollo: nb(f.marcaDaBollo), bolloAddebitato: nb(f.bolloAddebitato),
      stato: ns(f.stato) ?? 'bozza', dataInvioSdi: ns(f.dataInvioSdi), dataPagamento: ns(f.dataPagamento), pagMese: nn(f.pagMese), pagAnno: nn(f.pagAnno),
      modalitaPagamento: ns(f.modalitaPagamento), fatturaOriginaleId: ns(f.fatturaOriginaleId), tipoStorno: ns(f.tipoStorno),
      ncTotaleImporto: nn(f.ncTotaleImporto) ?? 0, ncIds: f.ncIds ? JSON.stringify(f.ncIds) : null, origine: ns(f.origine) ?? 'manuale', note: ns(f.note),
    };
  }).filter((r) => validate(S.zFattura, r, 'fatture', r.numeroDisplay, issues));

  const pagamenti = ex.pagamenti.map((p) => ({
    id: det('pagamento', pid, p.data, p.importo, p.tipo, p.descrizione, p.scheduleKey), profileId: pid,
    year: yearFromScheduleKey(p.scheduleKey) ?? yearFromIso(p.data) ?? p.year,
    data: ns(p.data) ?? '1970-01-01', tipo: ns(p.tipo) ?? 'altro', descrizione: ns(p.descrizione), importo: nn(p.importo) ?? 0,
    scheduleKey: ns(p.scheduleKey), linkedKeys: null, note: null,
  })).filter((r) => validate(S.zPagamento, r, 'pagamenti', `${r.data}/${r.importo}`, issues));

  const calendarEntries = ex.calendar.map((c) => ({ profileId: pid, year: c.year, month: c.month, day: c.day, activityCode: c.code }))
    .filter((r) => validate(S.zCalendar, r, 'calendarEntries', `${r.year}-${r.month}-${r.day}`, issues));

  const budgetItems = ex.budget.map((b) => ({ id: det('budget', pid, b.year, b.nome, b.importo), profileId: pid, year: b.year, nome: ns(b.nome) ?? '(voce)', importo: nn(b.importo) ?? 0, auto: nb(b.auto), ordine: b.ordine }))
    .filter((r) => validate(S.zBudget, r, 'budgetItems', `${r.year}/${r.nome}`, issues));

  const spese = ex.spese.map((s) => ({ id: det('spesa', pid, s.year, s.titolo, s.costo, s.deducibilita, s.anni), profileId: pid, year: s.year, titolo: ns(s.titolo) ?? '(spesa)', costo: nn(s.costo) ?? 0, deducibilita: nn(s.deducibilita) ?? 1, anni: nn(s.anni) ?? 1, categoria: ns(s.categoria) }))
    .filter((r) => validate(S.zSpesa, r, 'spese', `${r.year}/${r.titolo}`, issues));

  const dichiarazioni = ex.dichiarazioni.map(({ year, dichiarazione: d }) => ({
    profileId: pid, year, tipo: ns(d.tipoDichiarazione) ?? 'ordinaria',
    flags: d.flags ? JSON.stringify(d.flags) : null, contiEsteri: d.contiEsteri ? JSON.stringify(d.contiEsteri) : null,
    overrides: JSON.stringify({ ...(d.overrides ?? {}), ...(d.coniuge ? { _coniuge: d.coniuge } : {}), ...(d.familiariCarico ? { _familiariCarico: d.familiariCarico } : {}) }),
    statoCompilazione: d.statoCompilazione ? JSON.stringify({ legacy: d.statoCompilazione }) : null, confirmedWarnings: null,
  })).filter((r) => validate(S.zDichiarazione, r, 'dichiarazioni', `year ${r.year}`, issues));

  return { rows: { profiles, yearSettings, clienti, fatture, pagamenti, calendarEntries, budgetItems, spese, dichiarazioni }, issues };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/schemas.ts src/server/lib/import-calcolivari/map.ts src/server/lib/import-calcolivari/map.test.ts
git commit -m "feat(import): mapper 9 entità + validazione Zod + id deterministici"
```

---

## Task 6 — `registry.ts` + `plan.ts` (`buildImportPlan`)

**Files:**
- Create: `src/server/lib/import-calcolivari/registry.ts`, `plan.ts`
- Test: `src/server/lib/import-calcolivari/plan.test.ts`
- Riferimento: spec §6 (idempotenza), §7 (merge).

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/plan.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../../db/test-helper';
import { createUserWithDefaultProfile } from '../../lib/users';
import { buildImportPlan } from './plan';
import { OFFICIAL_SAMPLE } from '../../../test-fixtures/calcolivari-sample';

async function seed() {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  return db;
}

test('buildImportPlan: USER_NOT_FOUND se email assente', async () => {
  const { db } = await createTestDb();
  await assert.rejects(() => buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'ghost@x.it' }), /USER_NOT_FOUND/);
});

test('buildImportPlan: profilo nuovo → profileOp insert, child tutti insert', async () => {
  const db = await seed();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  assert.equal(plan.profileOp, 'insert');
  assert.equal(plan.slug, 'mattia');
  assert.ok(plan.entities.pagamenti.inserts.length >= 1);
  assert.equal(plan.entities.pagamenti.updates.length, 0);
});

test('buildImportPlan: merge longest-wins su due file', async () => {
  const db = await seed();
  const richer = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE));
  richer['calcoliPIVA_Mattia_clienti'] = [{ id: 'cli1', nome: 'ACME SRL', partitaIva: 'IT999', pec: 'a@pec.it' }];
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE, richer], { userEmail: 'mattia@test.it' });
  const cli = plan.entities.clienti.inserts.find((c: any) => c.id === 'cli1');
  assert.equal(cli.pec, 'a@pec.it'); // versione più ricca vince
});
```

- [ ] **Step 2: Run → FAIL** (anche per fixture mancante — la fixture arriva al Task 9; per ora il test fallisce sull'import, atteso).

- [ ] **Step 3: Implementare**

`src/server/lib/import-calcolivari/registry.ts`:
```ts
import { and, eq, type SQL } from 'drizzle-orm';
import { yearSettings, clienti, fatture, pagamenti, calendarEntries, budgetItems, spese, dichiarazioni } from '../../db/schema';
import type { MappedRows } from './types';

export interface EntitySpec {
  name: Exclude<keyof MappedRows, 'profiles'>;
  table: any;
  rowsOf: (m: MappedRows) => any[];
  keyOf: (row: any) => string;
  whereOf: (row: any) => SQL;
  touch: boolean; // ha colonna updatedAt
}

export const CHILD_ENTITIES: EntitySpec[] = [
  { name: 'yearSettings', table: yearSettings, rowsOf: (m) => m.yearSettings, keyOf: (r) => `${r.year}`, whereOf: (r) => and(eq(yearSettings.profileId, r.profileId), eq(yearSettings.year, r.year))!, touch: false },
  { name: 'clienti', table: clienti, rowsOf: (m) => m.clienti, keyOf: (r) => r.id, whereOf: (r) => eq(clienti.id, r.id), touch: true },
  { name: 'fatture', table: fatture, rowsOf: (m) => m.fatture, keyOf: (r) => `${r.annoProgressivo}:${r.progressivo}`, whereOf: (r) => and(eq(fatture.profileId, r.profileId), eq(fatture.annoProgressivo, r.annoProgressivo), eq(fatture.progressivo, r.progressivo))!, touch: true },
  { name: 'pagamenti', table: pagamenti, rowsOf: (m) => m.pagamenti, keyOf: (r) => r.id, whereOf: (r) => eq(pagamenti.id, r.id), touch: true },
  { name: 'calendarEntries', table: calendarEntries, rowsOf: (m) => m.calendarEntries, keyOf: (r) => `${r.year}:${r.month}:${r.day}`, whereOf: (r) => and(eq(calendarEntries.profileId, r.profileId), eq(calendarEntries.year, r.year), eq(calendarEntries.month, r.month), eq(calendarEntries.day, r.day))!, touch: true },
  { name: 'budgetItems', table: budgetItems, rowsOf: (m) => m.budgetItems, keyOf: (r) => r.id, whereOf: (r) => eq(budgetItems.id, r.id), touch: true },
  { name: 'spese', table: spese, rowsOf: (m) => m.spese, keyOf: (r) => r.id, whereOf: (r) => eq(spese.id, r.id), touch: true },
  { name: 'dichiarazioni', table: dichiarazioni, rowsOf: (m) => m.dichiarazioni, keyOf: (r) => `${r.year}`, whereOf: (r) => and(eq(dichiarazioni.profileId, r.profileId), eq(dichiarazioni.year, r.year))!, touch: true },
];
```

`src/server/lib/import-calcolivari/plan.ts`:
```ts
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

/** Dedup richer-wins su righe con la stessa identità naturale. */
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
  if (!user) throw new ImportError('USER_NOT_FOUND', `Utente "${opts.userEmail}" non trovato. Crea con: npm run create-user -- ${opts.userEmail} <password>`);

  const exps = inputs.map(detect);
  const profileName = exps[0]!.profileName;
  const slug = opts.slug ?? profileName.toLowerCase();

  const [existing] = await db.select().from(profiles).where(and(eq(profiles.userId, user.id), eq(profiles.slug, slug))).limit(1);
  const profileId = existing?.id ?? newId();

  // Map ogni file, poi merge richer-wins per entità.
  const issues: ImportIssue[] = [];
  const mappedList = exps.map((e) => {
    const r = mapAll(extractAll(e), { profileId, userId: user.id, slug });
    issues.push(...r.issues);
    return r.rows;
  });
  const merged = mergeMapped(mappedList);

  // Profilo: insert / update / identical.
  const profileRow = merged.profiles[0] ?? { id: profileId, userId: user.id, slug, displayName: slug };
  let profileOp: ProfileOp = 'insert';
  if (existing) profileOp = rowDiffers(profileRow, existing) ? 'update' : 'identical';

  // Child entities: diff vs DB.
  const entities: Record<string, EntityPlan> = {};
  for (const spec of CHILD_ENTITIES) {
    const rows = spec.rowsOf(merged);
    const existingRows: any[] = profileId === existing?.id
      ? await db.select().from(spec.table).where(eq(spec.table.profileId, profileId))
      : [];
    const byKey = new Map(existingRows.map((r) => [spec.keyOf(r), r]));
    const ep: EntityPlan = { entity: spec.name, inserts: [], updates: [], identical: 0 };
    for (const row of rows) {
      const ex = byKey.get(spec.keyOf(row));
      if (!ex) ep.inserts.push(row);
      else if (rowDiffers(row, ex)) ep.updates.push({ ...row, id: ex.id ?? row.id });
      else ep.identical++;
    }
    entities[spec.name] = ep;
  }

  return { profileName, userId: user.id, profileId, slug, profileOp, profileRow, entities, issues };
}

function mergeMapped(list: MappedRows[]): MappedRows {
  const concat = (sel: (m: MappedRows) => any[]) => list.flatMap(sel);
  const profilesMerged = list.map((m) => m.profiles[0]).filter(Boolean);
  return {
    profiles: profilesMerged.length ? [dedupRicher(profilesMerged, (p) => p.slug)[0]] : [],
    yearSettings: dedupRicher(concat((m) => m.yearSettings), (r) => `${r.year}`),
    clienti: dedupRicher(concat((m) => m.clienti), (r) => r.id),
    fatture: dedupRicher(concat((m) => m.fatture), (r) => `${r.annoProgressivo}:${r.progressivo}`),
    pagamenti: dedupRicher(concat((m) => m.pagamenti), (r) => r.id),
    calendarEntries: dedupRicher(concat((m) => m.calendarEntries), (r) => `${r.year}:${r.month}:${r.day}`),
    budgetItems: dedupRicher(concat((m) => m.budgetItems), (r) => r.id),
    spese: dedupRicher(concat((m) => m.spese), (r) => r.id),
    dichiarazioni: dedupRicher(concat((m) => m.dichiarazioni), (r) => `${r.year}`),
  };
}
```

- [ ] **Step 4: Run → PASS** (dopo Task 9 per la fixture; in subagent-driven, eseguire Task 9 prima del run finale di questo test, oppure usare un mini-fixture inline temporaneo).

> **Nota di ordinamento:** `plan.test.ts` ed `e2e.test.ts` dipendono dalla fixture del Task 9. Se esegui in TDD stretto, crea prima `src/test-fixtures/calcolivari-sample.ts` (Task 9 Step 1) e poi torna qui. Il codice di `plan.ts`/`registry.ts` non dipende dalla fixture.

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/registry.ts src/server/lib/import-calcolivari/plan.ts src/server/lib/import-calcolivari/plan.test.ts
git commit -m "feat(import): buildImportPlan (diff vs DB, merge longest-wins, registry generico)"
```

---

## Task 7 — `apply.ts` + `index.ts` (idempotenza)

**Files:**
- Create: `src/server/lib/import-calcolivari/apply.ts`, `index.ts`
- Test: `src/server/lib/import-calcolivari/apply.test.ts`
- Riferimento: spec §9 (sicurezza), §6 (idempotenza).

- [ ] **Step 1: Scrivere il test**

`src/server/lib/import-calcolivari/apply.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/test-helper';
import { createUserWithDefaultProfile } from '../../lib/users';
import { profiles, pagamenti } from '../../db/schema';
import { buildImportPlan } from './plan';
import { applyImportPlan } from './apply';
import { OFFICIAL_SAMPLE } from '../../../test-fixtures/calcolivari-sample';

async function seeded() {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  return db;
}

test('applyImportPlan: dry-run non scrive', async () => {
  const db = await seeded();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  await applyImportPlan(db, plan, { commit: false });
  const rows = await db.select().from(pagamenti);
  assert.equal(rows.length, 0);
});

test('applyImportPlan: commit popola DB + profilo creato', async () => {
  const db = await seeded();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  await applyImportPlan(db, plan, { commit: true });
  const [prof] = await db.select().from(profiles).where(eq(profiles.slug, 'mattia'));
  assert.ok(prof);
  const pag = await db.select().from(pagamenti).where(eq(pagamenti.profileId, prof!.id));
  assert.ok(pag.length >= 1);
});

test('applyImportPlan: re-run = no-op (idempotente)', async () => {
  const db = await seeded();
  await applyImportPlan(db, await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' }), { commit: true });
  const plan2 = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  assert.equal(plan2.profileOp, 'identical');
  for (const ep of Object.values(plan2.entities)) {
    assert.equal(ep.inserts.length, 0, `${ep.entity} inserts`);
    assert.equal(ep.updates.length, 0, `${ep.entity} updates`);
  }
});

test('applyImportPlan: fail-closed su issue di validazione', async () => {
  const db = await seeded();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  plan.issues.push({ entity: 'pagamenti', sourceKey: 'x', reason: 'fittizia' });
  await assert.rejects(() => applyImportPlan(db, plan, { commit: true }), /VALIDATION_ISSUES/);
  await applyImportPlan(db, plan, { commit: true, skipInvalid: true }); // override ok
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/lib/import-calcolivari/apply.ts`:
```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { profiles } from '../../db/schema';
import { ImportError } from './errors';
import { CHILD_ENTITIES } from './registry';
import type { ImportPlan } from './types';

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function snapshotProfile(db: Db, profileId: string): Promise<Record<string, any>> {
  const snap: Record<string, any> = {};
  const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  snap.profile = prof ?? null;
  for (const spec of CHILD_ENTITIES) {
    snap[spec.name] = await db.select().from(spec.table).where(eq(spec.table.profileId, profileId));
  }
  return snap;
}

export async function applyImportPlan(
  db: Db,
  plan: ImportPlan,
  opts: { commit: boolean; skipInvalid?: boolean },
): Promise<{ snapshotPath?: string }> {
  if (!opts.commit) return {};
  if (plan.issues.length && !opts.skipInvalid) {
    throw new ImportError('VALIDATION_ISSUES', `${plan.issues.length} issue di validazione — rivedi il dry-run o usa --skip-invalid.`);
  }

  // Snapshot pre-import (risk-table).
  const snap = await snapshotProfile(db, plan.profileId);
  const snapshotPath = join(tmpdir(), `lira-import-snapshot-${plan.slug}-${nowStamp()}.json`);
  writeFileSync(snapshotPath, JSON.stringify(snap, null, 2), 'utf8');

  await db.transaction(async (tx) => {
    if (plan.profileOp === 'insert') await tx.insert(profiles).values(plan.profileRow);
    else if (plan.profileOp === 'update') {
      const { id, ...rest } = plan.profileRow;
      await tx.update(profiles).set({ ...rest, updatedAt: new Date().toISOString() }).where(eq(profiles.id, plan.profileId));
    }
    for (const spec of CHILD_ENTITIES) {
      const ep = plan.entities[spec.name]!;
      if (ep.inserts.length) await tx.insert(spec.table).values(ep.inserts);
      for (const row of ep.updates) {
        const set = spec.touch ? { ...row, updatedAt: new Date().toISOString() } : { ...row };
        await tx.update(spec.table).set(set).where(spec.whereOf(row));
      }
    }
  });

  return { snapshotPath };
}
```

`src/server/lib/import-calcolivari/index.ts`:
```ts
export { buildImportPlan } from './plan';
export { applyImportPlan } from './apply';
export { ImportError } from './errors';
export type { ImportPlan, ImportIssue } from './types';
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**
```bash
git add src/server/lib/import-calcolivari/apply.ts src/server/lib/import-calcolivari/index.ts src/server/lib/import-calcolivari/apply.test.ts
git commit -m "feat(import): applyImportPlan (snapshot + transazione + fail-closed + idempotenza)"
```

---

## Task 8 — CLI `scripts/import-from-calcolivari.ts`

**Files:**
- Create: `scripts/import-from-calcolivari.ts`
- Test: `scripts/import-from-calcolivari.test.ts`
- Riferimento: spec §10 (CLI). Convenzione: `scripts/create-user.ts`.

- [ ] **Step 1: Scrivere il test (parsing argomenti puro)**

`scripts/import-from-calcolivari.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './import-from-calcolivari';

test('parseArgs: flag + files', () => {
  const a = parseArgs(['--user', 'm@x.it', '--slug', 'mattia', '--commit', 'a.json', 'b.json']);
  assert.equal(a.userEmail, 'm@x.it');
  assert.equal(a.slug, 'mattia');
  assert.equal(a.commit, true);
  assert.equal(a.skipInvalid, false);
  assert.deepEqual(a.files, ['a.json', 'b.json']);
});

test('parseArgs: dry-run di default', () => {
  const a = parseArgs(['--user', 'm@x.it', 'a.json']);
  assert.equal(a.commit, false);
});

test('parseArgs: --user mancante → errore', () => {
  assert.throws(() => parseArgs(['a.json']), /--user/);
});

test('parseArgs: nessun file → errore', () => {
  assert.throws(() => parseArgs(['--user', 'm@x.it']), /file/i);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`scripts/import-from-calcolivari.ts`:
```ts
import { readFileSync } from 'node:fs';
import { getDb } from '../src/server/db/client';
import { buildImportPlan, applyImportPlan, ImportError } from '../src/server/lib/import-calcolivari';
import type { ImportPlan } from '../src/server/lib/import-calcolivari';

export interface CliArgs {
  userEmail: string;
  slug?: string;
  commit: boolean;
  skipInvalid: boolean;
  files: string[];
}

export function parseArgs(argv: string[]): CliArgs {
  let userEmail: string | undefined;
  let slug: string | undefined;
  let commit = false;
  let skipInvalid = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') userEmail = argv[++i];
    else if (a === '--slug') slug = argv[++i];
    else if (a === '--commit') commit = true;
    else if (a === '--skip-invalid') skipInvalid = true;
    else files.push(a!);
  }
  if (!userEmail) throw new Error('Manca --user <email>. Uso: npm run import:legacy -- --user <email> [--slug s] [--commit] <file...>');
  if (files.length === 0) throw new Error('Nessun file di export indicato.');
  return { userEmail, slug, commit, skipInvalid, files };
}

function printReport(plan: ImportPlan, commit: boolean): void {
  console.log(`\nProfilo: ${plan.profileName} → slug "${plan.slug}" (${plan.profileOp})`);
  console.log('Entità            insert  update  identical');
  for (const [name, ep] of Object.entries(plan.entities)) {
    console.log(`  ${name.padEnd(16)} ${String(ep.inserts.length).padStart(6)}  ${String(ep.updates.length).padStart(6)}  ${String(ep.identical).padStart(9)}`);
  }
  if (plan.issues.length) {
    console.log(`\n⚠ ${plan.issues.length} issue di validazione:`);
    for (const i of plan.issues.slice(0, 20)) console.log(`  [${i.entity}] ${i.sourceKey}: ${i.reason}`);
  }
  console.log(commit ? '\nMODE: COMMIT (scrittura su DB)' : '\nMODE: DRY-RUN (nessuna scrittura). Aggiungi --commit per applicare.');
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const inputs = args.files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const db = getDb();

  try {
    const plan = await buildImportPlan(db, inputs, { userEmail: args.userEmail, slug: args.slug });
    printReport(plan, args.commit);
    if (args.commit) {
      const { snapshotPath } = await applyImportPlan(db, plan, { commit: true, skipInvalid: args.skipInvalid });
      console.log(`\n✓ Import applicato. Snapshot pre-import: ${snapshotPath}`);
    } else if (plan.issues.length) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err: any) {
    if (err instanceof ImportError && err.code === 'USER_NOT_FOUND') {
      console.error(err.message);
      process.exit(3);
    }
    console.error('Errore import:', err?.message ?? err);
    process.exit(1);
  }
}

// Esegui solo se invocato come script (non in import dai test).
if (process.argv[1] && process.argv[1].endsWith('import-from-calcolivari.ts')) {
  void main();
}
```

- [ ] **Step 4: Run → PASS** — `npm test -- --test-name-pattern "parseArgs"`.

- [ ] **Step 5: Commit**
```bash
git add scripts/import-from-calcolivari.ts scripts/import-from-calcolivari.test.ts
git commit -m "feat(import): CLI import:legacy (dry-run default, --commit, exit codes)"
```

---

## Task 9 — Fixture sintetica + E2E

**Files:**
- Create: `src/test-fixtures/calcolivari-sample.ts`
- Test: `src/server/lib/import-calcolivari/e2e.test.ts`

- [ ] **Step 1: Creare la fixture**

`src/test-fixtures/calcolivari-sample.ts`:
```ts
// Export CalcoliVari sintetico (formato ufficiale) che copre tutte le 9 entità,
// incl. insidie: pagamento cross-year, fattura legacy in _fattureManualeWipedBackup,
// lmQuadro legacy, calendar sparso. Congelato come golden anchor per regression.

export const OFFICIAL_SAMPLE: Record<string, unknown> = {
  'calcoliPIVA_Mattia_2024': {
    settings: {
      regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata',
      limiteForfettario: 85000, scadenziarioMetodoAcconti: 'storico',
      anagrafica: { nome: 'Mattia', codiceFiscale: 'RSSMTT90A01H501X' }, attivita: { partitaIva: '12345678901', codiceAteco: '62.01.00' },
    },
    pagamenti: [{ data: '2024-06-30', tipo: 'tasse', descrizione: 'saldo 2023', importo: 500, scheduleKey: 'imposta_saldo_2023' }],
    budget: [{ nome: 'Tasse da accantonare', importo: 1000, auto: true }, { nome: 'Vacanza', importo: 800 }],
    spese: [{ titolo: 'Laptop', costo: 1200, deducibilita: 1, anni: 2 }],
    calendar: { '3-15': 'F', '8-10': 'M', '6-1': '' },
    lmQuadro: { overrides: { LM_perditePregresse: 300 } },
    _fattureManualeWipedBackup: { '5': [{ importo: 300, desc: 'Consulenza vecchia', pagMese: 5, pagAnno: 2024 }] },
  },
  'calcoliPIVA_Mattia_2025': {
    settings: {
      regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata',
      limiteForfettario: 85000, anagrafica: { cognome: 'Rossi', residenzaComune: 'Milano' },
    },
    pagamenti: [
      { data: '2025-06-30', tipo: 'tasse', descrizione: 'acc1', importo: 900, scheduleKey: 'imposta_acc1_2025' },
      { data: '2025-08-20', tipo: 'contributi', descrizione: 'inps', importo: 1200, scheduleKey: 'contributi_acc1_2025' },
    ],
    dichiarazione: { tipoDichiarazione: 'ordinaria', flags: { annoMisto: false }, overrides: { LM_creditoImposta: 50 }, contiEsteri: [], statoCompilazione: 'bozza' },
  },
  'calcoliPIVA_Mattia_fattureEmesse': [
    { id: 'fat-1', annoProgressivo: 2025, progressivo: 7, numero: '7/2025', data: '2025-03-01', tipoDocumento: 'TD01', totaleLordo: 1500, righe: [{ descrizione: 'Sviluppo', quantita: 1, prezzoUnitario: 1500, iva: 0 }], stato: 'pagata', origine: 'wizard', clienteId: 'cli-1', pagMese: 4, pagAnno: 2025 },
  ],
  'calcoliPIVA_Mattia_clienti': [{ id: 'cli-1', nome: 'ACME Spa', tipoCliente: 'PG', partitaIva: '99988877766', codiceSDI: 'ABCDEF1' }],
  'calcoliPIVA_Mattia_clienteDefaultId': 'cli-1',
  'calcoliPIVA_Mattia_giorniIncasso': 45,
  'calcoliPIVA_profile_Mattia': { nome: 'Mattia', partitaIva: '12345678901', ateco: '62.01.00', iban: 'IT60X0542811101000000123456' },
};

// Variante backup-wrapper degli stessi dati (valori come stringhe).
export const WRAPPER_SAMPLE = {
  profile: 'Mattia',
  timestamp: '2026-05-25T10:00:00Z',
  keys: Object.fromEntries(Object.entries(OFFICIAL_SAMPLE).map(([k, v]) => [k, JSON.stringify(v)])),
};
```

- [ ] **Step 2: Scrivere l'E2E**

`src/server/lib/import-calcolivari/e2e.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/test-helper';
import { createUserWithDefaultProfile } from '../../lib/users';
import { profiles, pagamenti, fatture, clienti, yearSettings, budgetItems, spese, calendarEntries, dichiarazioni } from '../../db/schema';
import { buildImportPlan } from './plan';
import { applyImportPlan } from './apply';
import { OFFICIAL_SAMPLE, WRAPPER_SAMPLE } from '../../../test-fixtures/calcolivari-sample';

async function run(input: unknown) {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  const plan = await buildImportPlan(db, [input], { userEmail: 'mattia@test.it' });
  await applyImportPlan(db, plan, { commit: true });
  const [prof] = await db.select().from(profiles).where(eq(profiles.slug, 'mattia'));
  return { db, profileId: prof!.id };
}

test('E2E ufficiale: tutte le 9 entità popolate con i conteggi attesi', async () => {
  const { db, profileId } = await run(OFFICIAL_SAMPLE);
  const count = async (t: any) => (await db.select().from(t).where(eq(t.profileId, profileId))).length;
  assert.equal(await count(yearSettings), 2);
  assert.equal(await count(clienti), 1);
  assert.equal(await count(fatture), 2);          // 1 canonica + 1 legacy
  assert.equal(await count(pagamenti), 3);        // cross-year: 1 (2024) + 2 (2025)
  assert.equal(await count(budgetItems), 2);
  assert.equal(await count(spese), 1);
  assert.equal(await count(calendarEntries), 2);  // '6-1' vuoto scartato
  assert.equal(await count(dichiarazioni), 2);    // lmQuadro 2024 + dichiarazione 2025
});

test('E2E: pagamenti competenza da scheduleKey (anno corretto)', async () => {
  const { db, profileId } = await run(OFFICIAL_SAMPLE);
  const rows = await db.select().from(pagamenti).where(eq(pagamenti.profileId, profileId));
  const saldo = rows.find((r) => r.scheduleKey === 'imposta_saldo_2023');
  assert.equal(saldo!.year, 2023); // competenza, non anno di cassa (2024)
});

test('E2E backup-wrapper: stesso risultato dell ufficiale', async () => {
  const { db, profileId } = await run(WRAPPER_SAMPLE);
  const fat = await db.select().from(fatture).where(eq(fatture.profileId, profileId));
  assert.equal(fat.length, 2);
});

test('E2E idempotenza: secondo import = no-op', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  await applyImportPlan(db, await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' }), { commit: true });
  const plan2 = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  const totalWrites = Object.values(plan2.entities).reduce((s, ep) => s + ep.inserts.length + ep.updates.length, 0);
  assert.equal(totalWrites, 0);
  assert.equal(plan2.profileOp, 'identical');
});
```

- [ ] **Step 3: Run → PASS** — `npm test -- --test-name-pattern "E2E"`. Esegue anche `plan.test.ts`/`apply.test.ts` (ora la fixture esiste).

- [ ] **Step 4: Verifica suite completa** — `npm run typecheck && npm test`. Atteso: tutti i test verdi (154 esistenti + nuovi).

- [ ] **Step 5: Commit**
```bash
git add src/test-fixtures/calcolivari-sample.ts src/server/lib/import-calcolivari/e2e.test.ts
git commit -m "test(import): fixture sintetica + E2E (9 entità, wrapper, idempotenza)"
```

---

## Task 10 — Docs + verifica finale

**Files:**
- Modify: `docs/migration-plan.md`

- [ ] **Step 1: Aggiornare `migration-plan.md` Fase 9**

In `docs/migration-plan.md`, sezione `### Fase 9 — Import legacy + Switch`, spuntare la riga importer:
```markdown
- [x] `scripts/import-from-calcolivari.ts`: accetta uno o più JSON export di CalcoliVari, mappa al nuovo schema, idempotente, dry-run mode
```

- [ ] **Step 2: Verifica finale completa**

Run:
```bash
npm run typecheck
npm test
```
Atteso: `0 fail`, suite verde (154 baseline + nuovi test import).

- [ ] **Step 3: Commit**
```bash
git add docs/migration-plan.md
git commit -m "docs(migration-plan): Fase 9 importer implementato"
```

---

## Self-review checklist (eseguita in fase di scrittura piano)

- **Spec coverage:** §2 formati → Task 3; §2.4 catalogo chiavi → Task 4; §5 mapping 9 entità → Task 4+5; §6 identità → Task 1+5+6; §7 merge → Task 6; §8 decisioni (legacy fatture, accantonamento scartato, dry-run default, dedup pagamenti) → Task 4/5/7; §9 validazione/sicurezza → Task 5+7; §10 CLI → Task 8; §11 testing → ogni task + Task 9; §13 DoD → Task 9+10. ✅ (`accantonamento` volutamente non estratto: assente in `extract.ts`, come da §5.10).
- **Placeholder scan:** nessun TBD/TODO; ogni step ha codice completo.
- **Type consistency:** `det/newId` (Task 1) usati ovunque con stessa firma; `ExtractedData`/`MappedRows` (Task 1) usati in extract/map/plan; `EntitySpec.keyOf` (Task 6) coerente con `dedupRicher`/`mergeMapped`; `buildImportPlan`/`applyImportPlan` firme stabili tra Task 6/7/8/9.

## Note di esecuzione

- **Ordine fixture:** `plan.test.ts`/`apply.test.ts`/`e2e.test.ts` importano `src/test-fixtures/calcolivari-sample.ts` (Task 9 Step 1). In subagent-driven stretto, creare la fixture prima di far girare quei test (vedi nota nel Task 6).
- **Typing pragmatico:** il core generico (`registry.ts`/`plan.ts`/`apply.ts`) usa `any` sulle righe Drizzle dinamiche — accettabile in un importer-script; i mapper restano tipizzati via `$inferInsert`.
- **Idempotenza:** garantita da id deterministici (`det`) + chiavi naturali nel `plan`; il test E2E "secondo import = no-op" è il guard di regressione.
