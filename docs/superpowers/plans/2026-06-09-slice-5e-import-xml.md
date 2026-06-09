# Slice 5E — Import XML FatturaPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importare file XML FatturaPA (TD01/TD04) dalla pagina /fatture: il client parsa l'XML (DOMParser), il server valida, matcha/crea il cliente, deduplica e inserisce ogni fattura in stato `inviata` (`origine='import'`) col numero reale.

**Architecture:** Parser thin client-only (DOMParser → RawFattura) + logica pura `@shared/import-fattura.ts` (parseNumero, buildImportItem, matchCliente, dedupKey) testabile + endpoint `POST /api/fatture/import-xml` che valida (Zod) e inserisce. Nessuna migration, nessuna nuova dipendenza.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Hono, Drizzle (libSQL), Zod, Vite vanilla TS, Node `--test`.

**Porting source (CalcoliVari, sola lettura):**
- `CalcoliVari/fatture-import-xml.js` — `parseXml`, `parseNumero`, `matchCliente`, `dedupKey`.

**Reference patterns (Lira):**
- `src/server/routes/fatture.ts` — `toPublic`, `annoFromData`, `buildClienteSnapshot`, POST shape, `FatturaInsert`, `zJson`, scoping.
- `src/shared/fattura-logic.ts` — `computeImporto`.
- `src/shared/schemas.ts` (blocco Fatture) — `RigaSchema`, `TipoDocumentoEnum`.
- `src/server/db/schema.ts` — tabelle `fatture` (campo `origine`) e `clienti`.
- `src/client/pages/fatture.ts` — `render`, header con bottone "Nuova", `openModal`, `esc`.

**Conventions:** TS strict (`arr[0]!`). ESM. Errori via `HttpError`. Niente nuove dipendenze.

**Adattamenti rispetto a CalcoliVari:**
- `parseXml` (DOM + numero + mapping in una funzione) è SPLIT: `parse-fattura-xml.ts` (client, solo DOM → RawFattura) + `buildImportItem` (@shared, raw → ImportFatturaInput).
- `matchCliente` ritorna **l'id del cliente esistente o null** (non `{mode, draft}`); match su P.IVA→CF (lo schema Lira non ha colonne idPaese/idCodice separate — per gli esteri `partitaIva` contiene l'idCodice).
- Import sempre `inviata` (`origine='import'`), col numero reale (no `/invia`). TD04 importate senza nc-sync.

**Test runner note:** `npm test` esegue tutta la suite. Singolo file: `node --import tsx --test src/path/file.test.ts`.

---

## Task 1: Schema `ImportFatturaInput` + tipo `ImportReport`

**Files:**
- Modify: `src/shared/schemas.ts` (append) e `src/shared/types.ts` (append)
- Test: `src/shared/schemas.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/shared/schemas.test.ts`:

```ts
import { ImportFatturaInput } from './schemas';

test('ImportFatturaInput — minimo valido', () => {
  const it = ImportFatturaInput.parse({
    tipoDocumento: 'TD01', numero: '2026/1', data: '2026-03-01',
    annoProgressivo: 2026, progressivo: 1, numeroDisplay: '2026/1',
    righe: [{ descrizione: 'Consulenza', prezzoUnitario: 1000 }],
    importo: 1000, marcaDaBollo: true,
    clienteSnapshot: { nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', nazione: 'IT' },
  });
  assert.equal(it.tipoDocumento, 'TD01');
  assert.equal(it.righe[0]!.quantita, 1);
  assert.equal(it.modalitaPagamento, null);
});

test('ImportFatturaInput — tipoDocumento invalido → throw', () => {
  assert.throws(() => ImportFatturaInput.parse({
    tipoDocumento: 'XX', numero: '1', data: '2026-03-01', annoProgressivo: 2026, progressivo: 1,
    numeroDisplay: '2026/1', righe: [{ descrizione: 'x', prezzoUnitario: 1 }], importo: 1,
    marcaDaBollo: false, clienteSnapshot: { nome: 'X', tipoCliente: 'PG', nazione: 'IT' },
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: FAIL — `ImportFatturaInput` non esportato.

- [ ] **Step 3: Write minimal implementation**

Append a `src/shared/schemas.ts` (in fondo). Riusa `RigaSchema` e `TipoDocumentoEnum` (blocco Fatture 5A):

```ts
// ───── Import XML FatturaPA (Slice 5E) ─────

export const ImportClienteSnapshot = z.object({
  nome: z.string(),
  tipoCliente: z.string(),
  partitaIva: z.string().nullable().optional(),
  codiceFiscale: z.string().nullable().optional(),
  codiceSdi: z.string().nullable().optional(),
  pec: z.string().nullable().optional(),
  indirizzo: z.string().nullable().optional(),
  cap: z.string().nullable().optional(),
  citta: z.string().nullable().optional(),
  provincia: z.string().nullable().optional(),
  nazione: z.string(),
});

export const ImportFatturaInput = z.object({
  tipoDocumento: TipoDocumentoEnum,
  numero: z.string(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  annoProgressivo: z.number().int(),
  progressivo: z.number().int(),
  numeroDisplay: z.string(),
  righe: z.array(RigaSchema).min(1),
  importo: z.number(),
  marcaDaBollo: z.boolean(),
  modalitaPagamento: z.string().nullable().default(null),
  clienteSnapshot: ImportClienteSnapshot,
});

export const ImportXmlBody = z.object({
  items: z.array(ImportFatturaInput).min(1).max(500),
});
```

Append a `src/shared/types.ts` (merge nell'import esistente da `./schemas` + alias):

```ts
import {
  ImportFatturaInput as ImportFatturaInputSchema,
} from './schemas';
export type ImportFatturaInput = z.infer<typeof ImportFatturaInputSchema>;
export interface ImportReport {
  importate: number;
  clientiCreati: number;
  saltate: Array<{ numero: string; motivo: string }>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: PASS. Poi `npx tsc -p tsconfig.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts src/shared/schemas.test.ts src/shared/types.ts
git commit -m "feat(fatture): Zod ImportFatturaInput/ImportXmlBody + tipo ImportReport"
```

---

## Task 2: Logica pura — `@shared/import-fattura.ts`

**Files:**
- Create: `src/shared/import-fattura.ts`
- Test: `src/shared/import-fattura.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/import-fattura.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumero, matchCliente, dedupKey, buildImportItem, type RawFattura } from './import-fattura';

test('parseNumero — formati 3/2026, 2026/3, 42 puro, non parsabile', () => {
  assert.deepEqual(parseNumero('3/2026'), { progressivo: 3, anno: 2026 });
  assert.deepEqual(parseNumero('2026/3'), { anno: 2026, progressivo: 3 });
  assert.deepEqual(parseNumero('42'), { progressivo: 42, anno: 0 });
  assert.deepEqual(parseNumero('FT-001'), { progressivo: 0, anno: 0 });
});

test('matchCliente — P.IVA poi CF, miss → null', () => {
  const clienti = [
    { id: 'c1', partitaIva: '00743110157', codiceFiscale: null },
    { id: 'c2', partitaIva: null, codiceFiscale: 'RSSMRA80A01H501U' },
  ];
  assert.equal(matchCliente({ partitaIva: '00743110157' }, clienti), 'c1');
  assert.equal(matchCliente({ partitaIva: null, codiceFiscale: 'rssmra80a01h501u' }, clienti), 'c2');
  assert.equal(matchCliente({ partitaIva: '99999999999' }, clienti), null);
});

test('dedupKey — distingue TD01 e TD04', () => {
  const base = { tipoDocumento: 'TD01', annoProgressivo: 2026, progressivo: 1, numero: '2026/1' };
  assert.equal(dedupKey(base), 'TD01|2026|1|2026/1');
  assert.equal(dedupKey({ ...base, tipoDocumento: 'TD04' }), 'TD04|2026|1|2026/1');
});

function rawBase(over: Partial<RawFattura> = {}): RawFattura {
  return {
    tipoDocumento: 'TD01', data: '2026-03-01', numero: '2026/5', importoTotale: 1000, bolloImporto: 0,
    modalitaPagamento: 'MP05',
    cliente: {
      denominazione: 'ACME Srl', nome: '', cognome: '', partitaIva: '00743110157', idPaese: '', idCodice: '00743110157',
      codiceFiscale: '', indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO', nazione: 'IT',
    },
    righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500 }],
    ...over,
  };
}

test('buildImportItem — mappa raw → item, importo da righe, numeroDisplay', () => {
  const it = buildImportItem(rawBase());
  assert.equal(it.tipoDocumento, 'TD01');
  assert.equal(it.annoProgressivo, 2026);
  assert.equal(it.progressivo, 5);
  assert.equal(it.numeroDisplay, '2026/5');
  assert.equal(it.importo, 1000);
  assert.equal(it.clienteSnapshot.nome, 'ACME Srl');
  assert.equal(it.clienteSnapshot.tipoCliente, 'PG');
});

test('buildImportItem — numero puro: anno dalla data; righe vuote → fallback', () => {
  const it = buildImportItem(rawBase({ numero: '7', data: '2025-06-01', righe: [] }));
  assert.equal(it.annoProgressivo, 2025);
  assert.equal(it.progressivo, 7);
  assert.equal(it.numeroDisplay, '2025/7');
  assert.equal(it.righe.length, 1);
  assert.equal(it.righe[0]!.prezzoUnitario, 1000);
});

test('buildImportItem — cliente PF (no P.IVA) ed estero', () => {
  const pf = buildImportItem(rawBase({ cliente: { ...rawBase().cliente, denominazione: '', nome: 'Mario', cognome: 'Rossi', partitaIva: '', idCodice: '', codiceFiscale: 'RSSMRA80A01H501U' } }));
  assert.equal(pf.clienteSnapshot.nome, 'Mario Rossi');
  assert.equal(pf.clienteSnapshot.tipoCliente, 'PF');
  const est = buildImportItem(rawBase({ cliente: { ...rawBase().cliente, nazione: 'DE' } }));
  assert.equal(est.clienteSnapshot.tipoCliente, 'Estero');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/import-fattura.test.ts`
Expected: FAIL — `Cannot find module './import-fattura'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/import-fattura.ts
//
// Logica pura per l'import di fatture da XML FatturaPA (Slice 5E).
// Port da CalcoliVari/fatture-import-xml.js. Nessuna dipendenza DOM: il
// DOM-traversal vive in @client/lib/parse-fattura-xml.ts e produce RawFattura.

import { computeImporto } from './fattura-logic';
import type { ImportFatturaInput } from './types';

/** Struttura grezza estratta dall'XML dal parser client (stringhe già trim). */
export interface RawFattura {
  tipoDocumento: string;
  data: string;
  numero: string;
  importoTotale: number;
  bolloImporto: number;
  modalitaPagamento: string;
  cliente: {
    denominazione: string; nome: string; cognome: string;
    partitaIva: string; idPaese: string; idCodice: string; codiceFiscale: string;
    indirizzo: string; cap: string; citta: string; provincia: string; nazione: string;
  };
  righe: Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>;
}

function normU(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

/** Parsa il Numero FatturaPA: '3/2026' | '2026/3' | '42' puro. */
export function parseNumero(numeroXml: string): { progressivo: number; anno: number } {
  const s = String(numeroXml || '').trim();
  let m = s.match(/(\d+)\s*\/\s*(\d{4})$/);
  if (m) return { progressivo: parseInt(m[1]!, 10), anno: parseInt(m[2]!, 10) };
  m = s.match(/(\d{4})\s*\/\s*(\d+)$/);
  if (m) return { anno: parseInt(m[1]!, 10), progressivo: parseInt(m[2]!, 10) };
  m = s.match(/^\d+$/);
  if (m) return { progressivo: parseInt(s, 10), anno: 0 };
  return { progressivo: 0, anno: 0 };
}

/** Ritorna l'id del cliente esistente che matcha (P.IVA → CF), altrimenti null. */
export function matchCliente(
  snapshot: { partitaIva?: string | null; codiceFiscale?: string | null },
  clienti: Array<{ id: string; partitaIva: string | null; codiceFiscale: string | null }>,
): string | null {
  const p = normU(snapshot.partitaIva);
  if (p) { const hit = clienti.find((c) => normU(c.partitaIva) === p); if (hit) return hit.id; }
  const cf = normU(snapshot.codiceFiscale);
  if (cf) { const hit = clienti.find((c) => normU(c.codiceFiscale) === cf); if (hit) return hit.id; }
  return null;
}

/** Chiave di dedup idempotente. TD04 distinto da TD01 a parità di progressivo. */
export function dedupKey(item: { tipoDocumento: string; annoProgressivo: number; progressivo: number; numero: string }): string {
  return `${item.tipoDocumento || 'TD01'}|${item.annoProgressivo || 0}|${item.progressivo || 0}|${item.numero || ''}`;
}

/** Costruisce l'ImportFatturaInput dal RawFattura (numero, righe, snapshot, importo). */
export function buildImportItem(raw: RawFattura): ImportFatturaInput {
  const parsed = parseNumero(raw.numero);
  const annoProgressivo = parsed.anno
    || (raw.data ? parseInt(raw.data.slice(0, 4), 10) : new Date().getFullYear());
  const progressivo = parsed.progressivo || 0;
  const numeroDisplay = progressivo > 0 ? `${annoProgressivo}/${progressivo}` : (raw.numero || `${annoProgressivo}/0`);
  const tipoDocumento = raw.tipoDocumento === 'TD04' ? 'TD04' : 'TD01';

  const righe = raw.righe.length
    ? raw.righe.map((r) => ({
        descrizione: r.descrizione || '(importata)',
        quantita: Math.abs(Number(r.quantita) || 1),
        prezzoUnitario: Math.abs(Number(r.prezzoUnitario) || 0),
      }))
    : [{ descrizione: '(importata senza righe dettaglio)', quantita: 1, prezzoUnitario: Math.abs(raw.importoTotale) }];

  const c = raw.cliente;
  const nome = c.denominazione || `${c.nome} ${c.cognome}`.trim() || '(senza nome)';
  const partitaIva = (c.partitaIva || c.idCodice || '').trim();
  const nazione = (c.nazione || 'IT').toUpperCase();
  const tipoCliente = nazione !== 'IT' ? 'Estero' : (partitaIva ? 'PG' : 'PF');

  return {
    tipoDocumento,
    numero: raw.numero,
    data: raw.data,
    annoProgressivo,
    progressivo,
    numeroDisplay,
    righe,
    importo: computeImporto(righe),
    marcaDaBollo: raw.bolloImporto > 0,
    modalitaPagamento: raw.modalitaPagamento || null,
    clienteSnapshot: {
      nome,
      tipoCliente,
      partitaIva: partitaIva || null,
      codiceFiscale: (c.codiceFiscale || '').trim() || null,
      codiceSdi: null,
      pec: null,
      indirizzo: (c.indirizzo || '').trim() || null,
      cap: (c.cap || '').trim() || null,
      citta: (c.citta || '').trim() || null,
      provincia: (c.provincia || '').trim() || null,
      nazione,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/import-fattura.test.ts`
Expected: PASS (6 test). Poi `npx tsc -p tsconfig.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/shared/import-fattura.ts src/shared/import-fattura.test.ts
git commit -m "feat(fatture): logica pura import XML (parseNumero, matchCliente, dedupKey, buildImportItem)"
```

---

## Task 3: Parser thin client — `@client/lib/parse-fattura-xml.ts`

Solo DOM-traversal (browser). Non testabile in `node:test`; verificato via typecheck/build e smoke (Task 6).

**Files:**
- Create: `src/client/lib/parse-fattura-xml.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/client/lib/parse-fattura-xml.ts
//
// Parser thin FatturaPA (solo DOMParser, browser). Estrae le stringhe grezze
// in un RawFattura; ogni regola (numero, normalizzazioni) sta in @shared.

import type { RawFattura } from '@shared/import-fattura';

export class ImportParseError extends Error {}

function text(node: Element | null, tag: string): string {
  if (!node) return '';
  const el = node.getElementsByTagName(tag)[0];
  return el ? String(el.textContent || '').trim() : '';
}

function firstChild(node: Element | Document | null, tag: string): Element | null {
  if (!node) return null;
  return node.getElementsByTagName(tag)[0] ?? null;
}

function num(v: string): number {
  const n = parseFloat(String(v || '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Parsa un XML FatturaPA in RawFattura. Lancia ImportParseError su XML invalido. */
export function parseFatturaXml(xmlText: string): RawFattura {
  if (typeof xmlText !== 'string' || !xmlText.trim()) throw new ImportParseError('XML vuoto');
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror')[0]) throw new ImportParseError('XML non valido');

  const body = doc.getElementsByTagName('FatturaElettronicaBody')[0] ?? null;
  const header = doc.getElementsByTagName('FatturaElettronicaHeader')[0] ?? null;
  if (!body || !header) throw new ImportParseError('Struttura FatturaElettronica mancante');

  const datiGen = firstChild(body, 'DatiGeneraliDocumento');
  if (!datiGen) throw new ImportParseError('DatiGeneraliDocumento mancante');

  const datiBollo = firstChild(datiGen, 'DatiBollo');
  const cess = firstChild(header, 'CessionarioCommittente');
  const cessDati = firstChild(cess, 'DatiAnagrafici');
  const cessAnag = firstChild(cessDati, 'Anagrafica');
  const cessIva = firstChild(cessDati, 'IdFiscaleIVA');
  const cessSede = firstChild(cess, 'Sede');
  const dettPag = firstChild(firstChild(body, 'DatiPagamento'), 'DettaglioPagamento');

  const lineNodes = body.getElementsByTagName('DettaglioLinee');
  const righe: RawFattura['righe'] = [];
  for (let i = 0; i < lineNodes.length; i++) {
    const ln = lineNodes[i]!;
    righe.push({
      descrizione: text(ln, 'Descrizione'),
      quantita: num(text(ln, 'Quantita')) || 1,
      prezzoUnitario: num(text(ln, 'PrezzoUnitario')),
    });
  }

  return {
    tipoDocumento: text(datiGen, 'TipoDocumento') || 'TD01',
    data: text(datiGen, 'Data'),
    numero: text(datiGen, 'Numero'),
    importoTotale: num(text(datiGen, 'ImportoTotaleDocumento')),
    bolloImporto: datiBollo ? num(text(datiBollo, 'ImportoBollo')) : 0,
    modalitaPagamento: text(dettPag, 'ModalitaPagamento'),
    cliente: {
      denominazione: text(cessAnag, 'Denominazione'),
      nome: text(cessAnag, 'Nome'),
      cognome: text(cessAnag, 'Cognome'),
      partitaIva: text(cessIva, 'IdCodice'),
      idPaese: text(cessIva, 'IdPaese'),
      idCodice: text(cessIva, 'IdCodice'),
      codiceFiscale: text(cessDati, 'CodiceFiscale'),
      indirizzo: text(cessSede, 'Indirizzo'),
      cap: text(cessSede, 'CAP'),
      citta: text(cessSede, 'Comune'),
      provincia: text(cessSede, 'Provincia'),
      nazione: text(cessSede, 'Nazione') || 'IT',
    },
    righe,
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: pulito. (Il parser non ha test unit: `DOMParser` è browser-only; coperto da smoke al Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/client/lib/parse-fattura-xml.ts
git commit -m "feat(client): parser thin FatturaPA XML (DOMParser → RawFattura)"
```

---

## Task 4: Endpoint `POST /api/fatture/import-xml`

**Files:**
- Modify: `src/server/routes/fatture.ts`
- Test: `src/server/routes/fatture.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/server/routes/fatture.test.ts` (riusa `makeApp`, `J`):

```ts
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
  assert.equal(rep.clientiCreati, 0); // P.IVA combacia col cliente di makeApp
  const list = await (await app.request('/api/fatture', { headers })).json() as any[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.stato, 'inviata');
  assert.equal(list[0]!.numeroDisplay, '2026/1');
});

test('POST /import-xml — crea cliente nuovo se non matcha', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ items: [importItem({
      clienteSnapshot: { nome: 'Nuovo Cliente Srl', tipoCliente: 'PG', partitaIva: '12345670785', nazione: 'IT' },
    })] }),
  });
  const rep = (await r.json()) as any;
  assert.equal(rep.importate, 1);
  assert.equal(rep.clientiCreati, 1);
  const clienti = await (await app.request('/api/clienti', { headers })).json() as any[];
  assert.ok(clienti.some((c) => c.partitaIva === '12345670785'));
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

test('POST /import-xml — collisione progressivo (numero diverso) → saltata', async () => {
  const { app, headers } = await makeApp();
  await app.request('/api/fatture/import-xml', { method: 'POST', headers: J(headers), body: JSON.stringify({ items: [importItem()] }) });
  // stesso anno/progressivo, numero diverso
  const r = await app.request('/api/fatture/import-xml', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ items: [importItem({ numero: 'ALT-1' })] }),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — `/import-xml` ritorna 404.

- [ ] **Step 3: Write minimal implementation**

In `src/server/routes/fatture.ts` estendi gli import e aggiungi l'handler (dopo `/import` o in coda, prima dell'export non serve — basta dopo gli altri handler):

```ts
// import: aggiungi
import { ImportXmlBody } from '@shared/schemas';
import { matchCliente, dedupKey } from '@shared/import-fattura';
```

```ts
// ─────────── POST /import-xml ───────────
fattureRoute.post('/import-xml', zJson(ImportXmlBody), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const { items } = c.req.valid('json') as z.infer<typeof ImportXmlBody>;

  // Stato esistente del profilo: clienti (per match) e fatture (per dedup/collisione)
  const clientiRows = await db.select({ id: clienti.id, partitaIva: clienti.partitaIva, codiceFiscale: clienti.codiceFiscale })
    .from(clienti).where(eq(clienti.profileId, profileId));
  const fattureRows = await db.select({
    tipoDocumento: fatture.tipoDocumento, annoProgressivo: fatture.annoProgressivo,
    progressivo: fatture.progressivo, numeroDisplay: fatture.numeroDisplay,
  }).from(fatture).where(eq(fatture.profileId, profileId));

  const clientiList = clientiRows.map((r) => ({ id: r.id, partitaIva: r.partitaIva, codiceFiscale: r.codiceFiscale }));
  const seenDedup = new Set<string>();
  const seenProg = new Set<string>();
  for (const f of fattureRows) {
    seenDedup.add(`${f.tipoDocumento}|${f.annoProgressivo}|${f.progressivo}|${f.numeroDisplay ?? ''}`);
    if (f.progressivo != null) seenProg.add(`${f.annoProgressivo}|${f.progressivo}`);
  }
  // cache cliente creati in questo batch (chiave P.IVA||CF normalizzata)
  const createdClienti = new Map<string, string>();

  const report = { importate: 0, clientiCreati: 0, saltate: [] as Array<{ numero: string; motivo: string }> };

  for (const item of items) {
    const dk = dedupKey({ tipoDocumento: item.tipoDocumento, annoProgressivo: item.annoProgressivo, progressivo: item.progressivo, numero: item.numero });
    if (seenDedup.has(dk)) { report.saltate.push({ numero: item.numero, motivo: 'duplicato' }); continue; }
    const progKey = `${item.annoProgressivo}|${item.progressivo}`;
    if (item.progressivo > 0 && seenProg.has(progKey)) {
      report.saltate.push({ numero: item.numero, motivo: 'progressivo già in uso' }); continue;
    }

    // Cliente: match esistente → cache batch → crea nuovo
    let clienteId: string | null = matchCliente(item.clienteSnapshot, clientiList);
    if (!clienteId) {
      const key = `${(item.clienteSnapshot.partitaIva ?? '').trim().toUpperCase()}|${(item.clienteSnapshot.codiceFiscale ?? '').trim().toUpperCase()}`;
      if (key !== '|' && createdClienti.has(key)) {
        clienteId = createdClienti.get(key)!;
      } else {
        clienteId = await tryCreateClienteFromSnapshot(db, profileId, item.clienteSnapshot);
        if (clienteId) {
          report.clientiCreati++;
          clientiList.push({ id: clienteId, partitaIva: item.clienteSnapshot.partitaIva ?? null, codiceFiscale: item.clienteSnapshot.codiceFiscale ?? null });
          if (key !== '|') createdClienti.set(key, clienteId);
        }
      }
    }

    const id = randomUUID();
    const values: FatturaInsert = {
      id, profileId,
      clienteId,
      tipoDocumento: item.tipoDocumento,
      annoProgressivo: item.annoProgressivo,
      progressivo: item.progressivo > 0 ? item.progressivo : null,
      numeroDisplay: item.numeroDisplay,
      data: item.data,
      clienteSnapshot: JSON.stringify(item.clienteSnapshot),
      righe: JSON.stringify(item.righe),
      importo: item.importo,
      ritenuta: 0,
      contributoIntegrativo: 0,
      marcaDaBollo: item.marcaDaBollo ? 1 : 0,
      bolloAddebitato: 0,
      stato: 'inviata',
      dataInvioSdi: item.data,
      modalitaPagamento: item.modalitaPagamento ?? null,
      origine: 'import',
    };
    try {
      await db.insert(fatture).values(values);
    } catch (err) {
      report.saltate.push({ numero: item.numero, motivo: 'progressivo già in uso' });
      continue;
    }
    report.importate++;
    seenDedup.add(dk);
    if (item.progressivo > 0) seenProg.add(progKey);
  }

  return c.json(report);
});

/** Crea un cliente dallo snapshot import. Ritorna l'id o null se fallisce. */
async function tryCreateClienteFromSnapshot(
  db: AuthEnv['Variables']['db'], profileId: string, snap: z.infer<typeof ImportXmlBody>['items'][number]['clienteSnapshot'],
): Promise<string | null> {
  const id = randomUUID();
  try {
    await db.insert(clienti).values({
      id, profileId,
      nome: snap.nome || '(senza nome)',
      tipoCliente: snap.tipoCliente || 'PG',
      partitaIva: snap.partitaIva ?? null,
      codiceFiscale: snap.codiceFiscale ?? null,
      codiceSdi: snap.codiceSdi ?? null,
      pec: snap.pec ?? null,
      indirizzo: snap.indirizzo ?? null,
      cap: snap.cap ?? null,
      citta: snap.citta ?? null,
      provincia: snap.provincia ?? null,
      nazione: snap.nazione || 'IT',
    });
    return id;
  } catch {
    return null; // P.IVA/CF duplicata o dato invalido: la fattura entra con clienteId null
  }
}
```

> **Type note:** `AuthEnv['Variables']['db']` è il tipo `Db` (come in `buildClienteSnapshot`). Se scomodo, tipizza il param come `any` (coerente con `clearOtherDefaults` in `clienti.ts`). `FatturaInsert`/`clienti` sono già importati/definiti nel file (5A).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS (esistenti + 5 nuovi). Poi `npx tsc -p tsconfig.server.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): POST /import-xml — match/crea cliente, dedup, insert inviata origine=import"
```

---

## Task 5: Frontend — bottone "Importa XML" + report

**Files:**
- Modify: `src/client/lib/fatture-api.ts`
- Modify: `src/client/pages/fatture.ts`

- [ ] **Step 1: Aggiungi importXmlFatture al client**

In `src/client/lib/fatture-api.ts`: estendi l'import dei tipi e append:

```ts
import type { ImportFatturaInput, ImportReport } from '@shared/types';

export function importXmlFatture(items: ImportFatturaInput[]): Promise<ImportReport> {
  return api.post<ImportReport>('/api/fatture/import-xml', { items });
}
```

- [ ] **Step 2: Bottone + file picker + report nella pagina**

In `src/client/pages/fatture.ts`:

(a) Estendi gli import:
```ts
import { parseFatturaXml, ImportParseError } from '../lib/parse-fattura-xml';
import { buildImportItem } from '@shared/import-fattura';
import {
  listFatture, createFattura, updateFattura, removeFattura,
  inviaFattura, pagaFattura, downloadFatturaXml, createNotaCredito, importXmlFatture,
} from '../lib/fatture-api';
import type { FatturaPublic, ClientePublic, Riga, ImportFatturaInput } from '@shared/types';
```

(b) Nel template di `render()`, accanto al bottone "Nuova", aggiungi il bottone import + un input file nascosto. Sostituisci la riga del bottone "Nuova":
```ts
              <button class="btn btn-primary" data-new${clienti.length ? '' : ' disabled title="Crea prima un cliente"'}>Nuova</button>
```
con:
```ts
              <div style="display:flex;gap:var(--space-2);">
                <button class="btn btn-ghost" data-import-xml>Importa XML</button>
                <button class="btn btn-primary" data-new${clienti.length ? '' : ' disabled title="Crea prima un cliente"'}>Nuova</button>
              </div>
              <input type="file" accept=".xml,text/xml,application/xml" multiple data-xml-input hidden />
```

(c) In `render()`, dopo gli altri wiring (dopo i `[data-filter]`), cabla l'import:
```ts
    const fileInput = container.querySelector<HTMLInputElement>('[data-xml-input]');
    container.querySelector<HTMLButtonElement>('[data-import-xml]')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const files = Array.from(fileInput.files ?? []);
      fileInput.value = '';
      if (!files.length) return;
      const items: ImportFatturaInput[] = [];
      const erroriParse: string[] = [];
      for (const file of files) {
        try {
          items.push(buildImportItem(parseFatturaXml(await file.text())));
        } catch (err) {
          erroriParse.push(`${file.name}: ${err instanceof ImportParseError ? err.message : 'XML non valido'}`);
        }
      }
      if (!items.length) {
        alert('Nessun XML valido.\n' + erroriParse.join('\n'));
        return;
      }
      try {
        const rep = await importXmlFatture(items);
        const righeSaltate = rep.saltate.map((s) => `• ${s.numero}: ${s.motivo}`).join('\n');
        alert(`Importate: ${rep.importate}\nClienti creati: ${rep.clientiCreati}\nSaltate: ${rep.saltate.length}`
          + (righeSaltate ? `\n${righeSaltate}` : '')
          + (erroriParse.length ? `\nFile non parsati:\n${erroriParse.join('\n')}` : ''));
        await refresh();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Errore import');
      }
    });
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: typecheck pulito; build OK.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/fatture-api.ts src/client/pages/fatture.ts
git commit -m "feat(client): bottone Importa XML (parse client + import server + report)"
```

---

## Task 6: Smoke Playwright — import XML

**Files:**
- Modify: `scripts/smoke-playwright.mjs`

- [ ] **Step 1: Read the existing smoke script**

Apri `scripts/smoke-playwright.mjs`; identifica `BASE_URL`, il login, e dove finisce lo scenario Fatture (STEP 4C, Slice 5A). L'import scenario va dopo che l'utente è loggato e sulla pagina `/fatture`.

- [ ] **Step 2: Append the import scenario**

Aggiungi, nello stile dello script (adatta i selettori), dopo lo STEP 4C Fatture. Usa `setInputFiles` con un XML inline scritto su file tmp:

```js
// --- STEP 4D: Import XML (Slice 5E) ---
console.log('\n=== STEP 4D: Import XML ===');
const tmpXml = join(SCREENSHOT_DIR, 'smoke-fattura.xml');
const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader><CessionarioCommittente>
    <DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>00743110157</IdCodice></IdFiscaleIVA>
      <Anagrafica><Denominazione>Smoke Import Srl</Denominazione></Anagrafica></DatiAnagrafici>
    <Sede><Indirizzo>Via Test 1</Indirizzo><CAP>20100</CAP><Comune>Milano</Comune><Provincia>MI</Provincia><Nazione>IT</Nazione></Sede>
  </CessionarioCommittente></FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Data>2026-07-01</Data><Numero>2026/99</Numero><ImportoTotaleDocumento>500.00</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>
    <DatiBeniServizi><DettaglioLinee><Descrizione>Servizio importato</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>500.00</PrezzoUnitario><PrezzoTotale>500.00</PrezzoTotale></DettaglioLinee></DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
await (await import('node:fs/promises')).writeFile(tmpXml, xmlContent, 'utf8');
await page.goto(`${BASE_URL}/fatture`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
page.once('dialog', (d) => d.accept()); // alert del report
await page.setInputFiles('[data-xml-input]', tmpXml);
await page.waitForTimeout(2000);
const listImport = await page.textContent('[data-list]').catch(() => '');
check('Fattura XML importata (2026/99 in lista)', !!listImport && listImport.includes('2026/99'),
  `list="${(listImport || '').slice(0, 140)}"`);
await screenshot(page, '05k-import-xml');
```

> `join` e `SCREENSHOT_DIR` esistono già nello script. L'alert del report viene accettato con `page.once('dialog', ...)`. Se al re-run la 2026/99 è già importata, comparirà comunque in lista (il check resta verde).

- [ ] **Step 3: Run the smoke test**

Con dev server su (vedi header dello script): `node scripts/smoke-playwright.mjs`.
Expected: la riga `✓ Fattura XML importata` (o PASS) compare; lo script chiude.

> Lo smoke richiede il dev server e l'utente seed in `local.db` (vedi note 5A): se serve, `npm run reset-password -- matas300@gmail.com TestPasswordLunga1`. La password reale resta su Turso, non toccata.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-playwright.mjs
git commit -m "test(fatture): smoke Playwright import XML (upload → fattura in lista)"
```

---

## Task 7: Docs + verifica finale

**Files:**
- Modify: `docs/migration-plan.md`

- [ ] **Step 1: Aggiorna migration-plan**

In `docs/migration-plan.md`, Fase 5, sostituisci:

```markdown
- [ ] Import XML (nuove + legacy)
```

con:

```markdown
- [x] Import file XML FatturaPA (TD01/TD04) da /fatture: parse client + match/dedup server, insert inviata origine=import (Slice 5E, 2026-06-09)
```

- [ ] **Step 2: Suite intera + typecheck + build**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.server.json --noEmit && npm run build`
Expected: tutti i test verdi (292 di 5C + nuovi import-fattura/schema/endpoint), entrambi i typecheck puliti, build OK. Annota il nuovo totale.

- [ ] **Step 3: Commit**

```bash
git add docs/migration-plan.md
git commit -m "docs: Fase 5 Import XML FatturaPA completato (Slice 5E)"
```

- [ ] **Step 4: Definition of Done (spec §9)**

Conferma: logica pura (parseNumero/matchCliente/dedupKey/buildImportItem) ✓; Zod ImportFatturaInput ✓; parser thin client ✓; endpoint match/crea/dedup/collisione/TD04/report ✓; frontend bottone+report ✓; smoke ✓; suite/typecheck/build verdi ✓.

---

## Note per l'esecutore

- **Run from repo root** (`C:\Users\matti\Documents\Progetti\Lira\Lira`). Singolo test: `node --import tsx --test <file>`.
- **`noUncheckedIndexedAccess`**: `m[1]!`, `arr[0]!` o guard (il codice fornito lo fa).
- **Nessuna nuova dipendenza** (DOMParser è nativo del browser); nessuna migration.
- **Server autoritativo:** il client parsa, ma il server RI-VALIDA con Zod (`ImportXmlBody`) e decide cosa salvare. Un client malevolo non può inserire dati fuori schema.
- **Import = inviata, numero reale:** nessuna chiamata a `/invia`; `progressivo` viene dall'XML. Per le NC TD04 importate: nessun nc-sync (storiche/esterne).
- **Idempotenza:** ri-import dello stesso XML → `dedupKey` lo salta. La collisione di `(anno, progressivo)` con numero diverso → saltata (sia via set in-memory sia via UNIQUE index in fallback try/catch).
- **Cliente:** match P.IVA→CF; miss → creazione best-effort (fallisce silenziosa → `clienteId=null`, snapshot comunque congelato).
```
