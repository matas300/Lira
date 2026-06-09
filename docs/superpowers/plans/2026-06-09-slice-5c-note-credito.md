# Slice 5C — Note di Credito TD04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Note di Credito TD04 end-to-end: creazione legata a una fattura emessa, sincronizzazione storno (parziale/totale) sull'originale, e generazione XML FatturaPA TD04 (importi negativi + DatiFattureCollegate).

**Architecture:** Una NC è una fattura con `tipoDocumento='TD04'` (riusa tabella `fatture`, route `/api/fatture`, numerazione 5A, XML 5B). Aggiunge logica pura `@shared/nc-sync.ts` (port di `CalcoliVari/fatture-nc-sync.js`), estende `buildFatturaXml` con il ramo TD04, ed estende `/invia` con il side-effect storno. Nessuna migration (campi NC già a schema da 5A).

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Hono, Drizzle (libSQL), Zod, Vite vanilla TS, Node `--test`.

**Porting source (CalcoliVari, sola lettura):**
- `CalcoliVari/fatture-nc-sync.js` — `applyNCToOriginal` (tolleranza 0,01, idempotenza, edge origImp≤0) + `isNCDateValid`.
- `CalcoliVari/fatture-docs-feature.js:1718-1784` — `_buildXmlDettaglioLinee` (sign), `_buildXmlDatiFattureCollegate`.

**Reference patterns (Lira):**
- `src/server/routes/fatture.ts` — route 5A/5B, `toPublic`, `parseJson`, `computeImporto`, `annoFromData`, `regimeFor`, handler `/invia` e `/:id/xml`.
- `src/shared/fattura-xml.ts` — `buildFatturaXml`, `buildDettaglioLinee`, `FatturaXmlInput`, golden TD01.
- `src/shared/fattura-logic.ts` — `computeImporto`, `SOGLIA_BOLLO`.
- `src/shared/schemas.ts` (fine, blocco Fatture) — `RigaSchema`, `FatturaCreateInput`, `TipoDocumentoEnum`.
- `src/client/pages/fatture.ts` — `rowHtml`/`renderList`/`openFatturaModal`, `esc()`, `eur()`.

**Conventions:** TS strict (`arr[0]!` o guard). ESM. Errori via `HttpError(status, code, message, details?)`. Niente nuove dipendenze.

**Adattamenti rispetto a CalcoliVari (deliberati):**
- `applyNCToOriginal` muta array in-place; in Lira `computeStorno` è **puro** (prende primitivi, ritorna i nuovi valori), e la route li persiste.
- Lo storno si applica a `/invia` della NC; le due UPDATE (originale + NC) vanno in un `db.transaction` idempotente subito dopo la numerazione (la numerazione resta il singolo UPDATE atomico di 5A; l'idempotenza via `ncIds` copre il caso di crash-between).
- `tipoDocumento` su `FatturaXmlInput` è opzionale e default `'TD01'`: i chiamanti TD01 esistenti (golden, endpoint) non cambiano.

**Test runner note:** `npm test` esegue tutta la suite. Singolo file: `node --import tsx --test src/path/file.test.ts`.

---

## Task 1: Logica pura storno — `@shared/nc-sync.ts`

Port di `applyNCToOriginal`/`isNCDateValid` come funzioni pure.

**Files:**
- Create: `src/shared/nc-sync.ts`
- Test: `src/shared/nc-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/nc-sync.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStorno, isNCDateValid } from './nc-sync';

function base(over = {}) {
  return {
    originaleImporto: 500, originaleStato: 'inviata',
    originaleNcIds: [] as string[], originaleNcTotaleImporto: 0,
    ncId: 'nc1', ncImporto: 500, ...over,
  };
}

test('computeStorno — totale: stornata, tipoStorno totale, ncIds aggiornati', () => {
  const r = computeStorno(base());
  assert.equal(r.applied, true);
  assert.equal(r.tipoStorno, 'totale');
  assert.equal(r.ncTotaleImporto, 500);
  assert.deepEqual(r.ncIds, ['nc1']);
  assert.equal(r.stato, 'stornata');
});

test('computeStorno — parziale (100 su 500): stato resta inviata', () => {
  const r = computeStorno(base({ ncImporto: 100 }));
  assert.equal(r.tipoStorno, 'parziale');
  assert.equal(r.ncTotaleImporto, 100);
  assert.equal(r.stato, 'inviata');
});

test('computeStorno — due parziali fino al totale → stornata', () => {
  const r1 = computeStorno(base({ originaleImporto: 1000, ncId: 'a', ncImporto: 400, originaleStato: 'pagata' }));
  assert.equal(r1.tipoStorno, 'parziale');
  assert.equal(r1.stato, 'pagata');
  const r2 = computeStorno({
    originaleImporto: 1000, originaleStato: 'pagata',
    originaleNcIds: r1.ncIds, originaleNcTotaleImporto: r1.ncTotaleImporto,
    ncId: 'b', ncImporto: 600,
  });
  assert.equal(r2.ncTotaleImporto, 1000);
  assert.equal(r2.tipoStorno, 'totale');
  assert.equal(r2.stato, 'stornata');
});

test('computeStorno — idempotente: stessa ncId non raddoppia', () => {
  const r = computeStorno(base({ originaleNcIds: ['nc1'], originaleNcTotaleImporto: 500 }));
  assert.equal(r.applied, false);
  assert.equal(r.ncTotaleImporto, 500);
  assert.deepEqual(r.ncIds, ['nc1']);
  assert.equal(r.tipoStorno, 'totale');
});

test('computeStorno — tolleranza 0,01: 999,99 su 1000 → totale; 999,98 → parziale', () => {
  assert.equal(computeStorno(base({ originaleImporto: 1000, ncImporto: 999.99 })).tipoStorno, 'totale');
  assert.equal(computeStorno(base({ originaleImporto: 1000, ncImporto: 999.98 })).tipoStorno, 'parziale');
});

test('computeStorno — edge origImp<=0 → parziale, non stornata', () => {
  const r = computeStorno(base({ originaleImporto: 0, ncImporto: 0 }));
  assert.equal(r.tipoStorno, 'parziale');
  assert.equal(r.stato, 'inviata');
});

test('computeStorno — arrotondamento 2 decimali (3*33.333=99.999→100)', () => {
  const r = computeStorno(base({ originaleImporto: 100, ncImporto: 99.999 }));
  assert.equal(r.ncTotaleImporto, 100);
  assert.equal(r.tipoStorno, 'totale');
});

test('isNCDateValid — NC >= originale', () => {
  assert.equal(isNCDateValid('2026-03-15', '2026-03-15'), true);
  assert.equal(isNCDateValid('2026-04-01', '2026-03-15'), true);
  assert.equal(isNCDateValid('2026-03-14', '2026-03-15'), false);
  assert.equal(isNCDateValid(null, '2026-03-15'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/nc-sync.test.ts`
Expected: FAIL — `Cannot find module './nc-sync'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/nc-sync.ts
//
// Sincronizzazione storno Nota di Credito (TD04) → fattura originale.
// Port puro di CalcoliVari/fatture-nc-sync.js: nessuna mutazione, ritorna i
// nuovi valori da persistere. Idempotente via ncIds, tolleranza 0,01.

const TOLLERANZA_TOTALE = 0.01; // €: sotto questa soglia uno storno parziale vale come totale

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface StornoInput {
  originaleImporto: number;
  originaleStato: string;
  originaleNcIds: string[];
  originaleNcTotaleImporto: number;
  ncId: string;
  ncImporto: number;
}

export interface StornoResult {
  applied: boolean;
  tipoStorno: 'parziale' | 'totale';
  ncIds: string[];
  ncTotaleImporto: number;
  stato: string;
}

/** Calcola gli effetti di una NC TD04 inviata sull'originale. Puro/idempotente. */
export function computeStorno(input: StornoInput): StornoResult {
  const prevIds = Array.isArray(input.originaleNcIds) ? input.originaleNcIds : [];
  const already = prevIds.indexOf(input.ncId) >= 0;
  const ncImp = Math.abs(Number(input.ncImporto) || 0);

  const ncIds = already ? prevIds.slice() : [...prevIds, input.ncId];
  const ncTotaleImporto = already
    ? round2(Number(input.originaleNcTotaleImporto) || 0)
    : round2((Number(input.originaleNcTotaleImporto) || 0) + ncImp);

  const origImp = Number(input.originaleImporto) || 0;
  let tipoStorno: 'parziale' | 'totale';
  if (origImp <= 0) {
    tipoStorno = 'parziale';
  } else {
    tipoStorno = (ncTotaleImporto + TOLLERANZA_TOTALE >= origImp) ? 'totale' : 'parziale';
  }

  const stato = (tipoStorno === 'totale' && input.originaleStato !== 'stornata')
    ? 'stornata'
    : input.originaleStato;

  return { applied: !already, tipoStorno, ncIds, ncTotaleImporto, stato };
}

/** data NC >= data originale (ISO YYYY-MM-DD). true se una delle due manca. */
export function isNCDateValid(dataNC: string | null | undefined, dataOriginale: string | null | undefined): boolean {
  if (!dataNC || !dataOriginale) return true;
  return String(dataNC) >= String(dataOriginale);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/nc-sync.test.ts`
Expected: PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add src/shared/nc-sync.ts src/shared/nc-sync.test.ts
git commit -m "feat(fatture): nc-sync puro (computeStorno parziale/totale idempotente + isNCDateValid)"
```

---

## Task 2: Schema `NotaCreditoCreateInput`

**Files:**
- Modify: `src/shared/schemas.ts` (append in fondo, dopo il blocco Fatture)
- Test: `src/shared/schemas.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/shared/schemas.test.ts`:

```ts
import { NotaCreditoCreateInput } from './schemas';

test('NotaCreditoCreateInput — minimo valido', () => {
  const nc = NotaCreditoCreateInput.parse({
    data: '2026-04-01', righe: [{ descrizione: 'Storno', prezzoUnitario: 100 }],
  });
  assert.equal(nc.righe[0]!.quantita, 1);
  assert.equal(nc.righe[0]!.prezzoUnitario, 100);
});

test('NotaCreditoCreateInput — righe vuote → throw', () => {
  assert.throws(() => NotaCreditoCreateInput.parse({ data: '2026-04-01', righe: [] }));
});

test('NotaCreditoCreateInput — data non ISO → throw', () => {
  assert.throws(() => NotaCreditoCreateInput.parse({ data: '01/04/2026', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: FAIL — `NotaCreditoCreateInput` non esportato.

- [ ] **Step 3: Write minimal implementation**

Append a `src/shared/schemas.ts` (in fondo). `RigaSchema` e `ISO_DATE` sono già definiti nel blocco Fatture; riusarli:

```ts
// ───── Note di Credito (Slice 5C) ─────

export const NotaCreditoCreateInput = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data attesa in formato YYYY-MM-DD'),
  righe: z.array(RigaSchema).min(1, 'Almeno una riga'),
  note: z.string().trim().optional().nullable(),
});
```

> `RigaSchema` è già esportato nel blocco Fatture dello stesso file (Slice 5A). Non ridefinirlo.

Append a `src/shared/types.ts` (merge nel blocco import esistente da `./schemas` + alias):

```ts
import { NotaCreditoCreateInput as NotaCreditoCreateInputSchema } from './schemas';
export type NotaCreditoCreateInput = z.infer<typeof NotaCreditoCreateInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: PASS. Poi `npx tsc -p tsconfig.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts src/shared/schemas.test.ts src/shared/types.ts
git commit -m "feat(fatture): Zod NotaCreditoCreateInput + tipo derivato"
```

---

## Task 3: Estendi `buildFatturaXml` per TD04 (sign=-1 + DatiFattureCollegate)

**Files:**
- Modify: `src/shared/fattura-xml.ts`
- Test: `src/shared/fattura-xml.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/shared/fattura-xml.test.ts`:

```ts
test('buildFatturaXml — TD04: importi negativi + DatiFattureCollegate', () => {
  const xml = buildFatturaXml({
    ...inputBase(),
    tipoDocumento: 'TD04',
    fatturaOriginale: { numero: '2026/1', data: '2026-03-01' },
    marcaDaBollo: false,
  });
  assert.match(xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(xml, /<PrezzoTotale>-1000\.00<\/PrezzoTotale>/);
  assert.match(xml, /<ImponibileImporto>-1000\.00<\/ImponibileImporto>/);
  assert.match(xml, /<ImportoTotaleDocumento>-1000\.00<\/ImportoTotaleDocumento>/);
  assert.match(xml, /<DatiFattureCollegate>\s*<RiferimentoNumeroLinea>1<\/RiferimentoNumeroLinea>\s*<IdDocumento>2026\/1<\/IdDocumento>\s*<Data>2026-03-01<\/Data>\s*<\/DatiFattureCollegate>/);
  assert.ok(!/<DatiBollo>/.test(xml)); // niente bollo su NC
});

test('buildFatturaXml — TD04: DatiFattureCollegate dopo DatiGeneraliDocumento (ordine XSD)', () => {
  const xml = buildFatturaXml({
    ...inputBase(), tipoDocumento: 'TD04',
    fatturaOriginale: { numero: '2026/1', data: '2026-03-01' }, marcaDaBollo: false,
  });
  assert.ok(xml.indexOf('</DatiGeneraliDocumento>') < xml.indexOf('<DatiFattureCollegate>'), 'DatiFattureCollegate deve seguire DatiGeneraliDocumento');
});

test('buildFatturaXml — TD01 invariato (default tipoDocumento)', () => {
  const xml = buildFatturaXml(inputBase());
  assert.match(xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
  assert.match(xml, /<ImponibileImporto>1000\.00<\/ImponibileImporto>/);
  assert.ok(!/<DatiFattureCollegate>/.test(xml));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: FAIL — `tipoDocumento`/`fatturaOriginale` non sul tipo; TD04 non emesso.

- [ ] **Step 3: Write minimal implementation**

In `src/shared/fattura-xml.ts`:

(a) Estendi `FatturaXmlInput` aggiungendo due campi opzionali (dopo `contributoIntegrativo: number;`):

```ts
  tipoDocumento?: 'TD01' | 'TD04';
  fatturaOriginale?: { numero: string; data: string };
```

(b) Sostituisci la funzione `buildDettaglioLinee` con la versione che applica `sign` e salta il rimborso bollo per le NC:

```ts
function buildDettaglioLinee(input: FatturaXmlInput, sign: number): { linee: string[]; rimborsoBollo: boolean } {
  let n = 0;
  const linee = input.righe.map((line) => {
    n++;
    const qta = parseMaybeNumber(line.quantita) || 1;
    const pu = round2(parseMaybeNumber(line.prezzoUnitario));
    const tot = round2(qta * pu * sign);
    const desc = sanitizeXmlLatin1(line.descrizione || 'Prestazione professionale').slice(0, 1000);
    return '    <DettaglioLinee>\n'
      + '      <NumeroLinea>' + n + '</NumeroLinea>\n'
      + '      <Descrizione>' + xmlEscape(desc) + '</Descrizione>\n'
      + '      <Quantita>' + fmtXmlNum(qta) + '</Quantita>\n'
      + '      <PrezzoUnitario>' + fmtXmlNum(pu) + '</PrezzoUnitario>\n'
      + '      <PrezzoTotale>' + fmtXmlNum(tot) + '</PrezzoTotale>\n'
      + '      <AliquotaIVA>0.00</AliquotaIVA>\n'
      + '      <Natura>N2.2</Natura>\n'
      + '    </DettaglioLinee>';
  });
  // Rimborso bollo solo su TD01 (sign=1) con bollo addebitato sopra soglia.
  const rimborsoBollo = sign === 1 && input.marcaDaBollo && input.bolloAddebitato && round2(input.importo) > SOGLIA_BOLLO;
  if (rimborsoBollo) {
    n++;
    linee.push('    <DettaglioLinee>\n'
      + '      <NumeroLinea>' + n + '</NumeroLinea>\n'
      + '      <Descrizione>Rimborso imposta di bollo</Descrizione>\n'
      + '      <Quantita>1.00</Quantita>\n'
      + '      <PrezzoUnitario>2.00</PrezzoUnitario>\n'
      + '      <PrezzoTotale>2.00</PrezzoTotale>\n'
      + '      <AliquotaIVA>0.00</AliquotaIVA>\n'
      + '      <Natura>N1</Natura>\n'
      + '    </DettaglioLinee>');
  }
  return { linee, rimborsoBollo };
}

/** DatiFattureCollegate (dentro DatiGenerali, dopo DatiGeneraliDocumento). Solo NC. */
function buildDatiFattureCollegate(orig: { numero: string; data: string } | undefined): string {
  if (!orig) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(orig.data))) {
    throw new Error('NC: data fattura originale "' + orig.data + '" non in formato ISO YYYY-MM-DD (XSD xs:date).');
  }
  return '\n    <DatiFattureCollegate>\n'
    + '      <RiferimentoNumeroLinea>1</RiferimentoNumeroLinea>\n'
    + '      <IdDocumento>' + xmlEscape(orig.numero) + '</IdDocumento>\n'
    + '      <Data>' + xmlEscape(orig.data) + '</Data>\n'
    + '    </DatiFattureCollegate>';
}
```

(c) Modifica `buildFatturaXml`: calcola `tipoDoc`/`sign`, passa `sign` a `buildDettaglioLinee`, applica `sign` agli importi del riepilogo/totale/pagamento, e inserisci `DatiFattureCollegate`. Sostituisci le righe interessate:

- All'inizio di `buildFatturaXml`, dopo `const c = input.cliente;`:
```ts
  const tipoDoc = input.tipoDocumento || 'TD01';
  const sign = tipoDoc === 'TD04' ? -1 : 1;
```
- La riga `const { linee, rimborsoBollo } = buildDettaglioLinee(input);` diventa:
```ts
  const { linee, rimborsoBollo } = buildDettaglioLinee(input, sign);
```
- `datiBollo`: solo TD01 (sign=1). La riga diventa:
```ts
  const datiBollo = (sign === 1 && input.marcaDaBollo && imponibile > SOGLIA_BOLLO)
    ? '\n      <DatiBollo>\n        <BolloVirtuale>SI</BolloVirtuale>\n        <ImportoBollo>2.00</ImportoBollo>\n      </DatiBollo>'
    : '';
```
- `dggParts.push('<TipoDocumento>TD01</TipoDocumento>');` diventa:
```ts
  dggParts.push('<TipoDocumento>' + tipoDoc + '</TipoDocumento>');
```
- `importoTotale`: applica sign. La riga diventa:
```ts
  const importoTotale = round2((input.importo + (rimborsoBollo ? 2 : 0)) * sign);
```
- Aggiungi, dopo `const datiGeneraliDocumentoXml = ...`:
```ts
  const datiFattureCollegate = buildDatiFattureCollegate(input.fatturaOriginale);
```
- Nel template, `<DatiGenerali>` diventa:
```
    <DatiGenerali>
      ${datiGeneraliDocumentoXml}${datiFattureCollegate}
    </DatiGenerali>
```
- `ImponibileImporto`: applica sign. Nel template, la riga diventa:
```
        <ImponibileImporto>${fmtXmlNum(round2(imponibile * sign))}</ImponibileImporto>
```
- `ImportoPagamento`: il calcolo usa già `importoTotale` (ora segnato). La riga resta:
```
        <ImportoPagamento>${fmtXmlNum(round2(importoTotale - (Number(input.ritenuta) || 0) * sign))}</ImportoPagamento>
```

> Nota: `imponibile` resta `round2(input.importo)` (positivo); il segno si applica solo in output. `importoTotale` è già segnato. Per TD04 forfettario senza ritenuta, `ImportoPagamento == importoTotale`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: PASS (incl. i 3 nuovi TD04 + tutti i TD01 esistenti, golden TD01 incluso, invariati).
Poi: `npx tsc -p tsconfig.json --noEmit` → pulito.

- [ ] **Step 5: Genera il golden TD04 e aggiungi il test byte-a-byte**

Crea `_gen_golden_nc.mjs` nella root:
```js
import { buildFatturaXml } from './src/shared/fattura-xml.ts';
const input = {
  cedente: { partitaIva: '00743110157', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
    indirizzo: 'Via Roma 1', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT', regime: 'forfettario' },
  cliente: { nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', codiceFiscale: null,
    codiceSdi: '0000000', pec: null, indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO', nazione: 'IT' },
  numero: '2026/2', data: '2026-04-01',
  righe: [{ descrizione: 'Storno consulenza informatica', quantita: 2, prezzoUnitario: 500 }],
  importo: 1000, ritenuta: 0, aliquotaRitenuta: null, tipoRitenuta: null, causaleRitenuta: null,
  marcaDaBollo: false, bolloAddebitato: false, modalitaPagamento: 'bonifico', contributoIntegrativo: 0,
  tipoDocumento: 'TD04', fatturaOriginale: { numero: '2026/1', data: '2026-03-01' },
};
process.stdout.write(buildFatturaXml(input));
```
Run: `node --import tsx _gen_golden_nc.mjs > src/shared/__fixtures__/nota-credito-golden.xml` poi `rm _gen_golden_nc.mjs`.
**Ispeziona** il file generato: TipoDocumento TD04, PrezzoTotale/ImponibileImporto/ImportoTotaleDocumento negativi, DatiFattureCollegate presente dopo DatiGeneraliDocumento, niente DatiBollo.

Append a `src/shared/fattura-xml.test.ts`:
```ts
test('GOLDEN — XML TD04 byte-identico al riferimento', () => {
  const golden = readFileSync(new URL('./__fixtures__/nota-credito-golden.xml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const input: FatturaXmlInput = {
    cedente: { partitaIva: '00743110157', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
      indirizzo: 'Via Roma 1', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT', regime: 'forfettario' },
    cliente: { nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', codiceFiscale: null,
      codiceSdi: '0000000', pec: null, indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO', nazione: 'IT' },
    numero: '2026/2', data: '2026-04-01',
    righe: [{ descrizione: 'Storno consulenza informatica', quantita: 2, prezzoUnitario: 500 }],
    importo: 1000, ritenuta: 0, aliquotaRitenuta: null, tipoRitenuta: null, causaleRitenuta: null,
    marcaDaBollo: false, bolloAddebitato: false, modalitaPagamento: 'bonifico', contributoIntegrativo: 0,
    tipoDocumento: 'TD04', fatturaOriginale: { numero: '2026/1', data: '2026-03-01' },
  };
  assert.equal(buildFatturaXml(input), golden);
});
```
(`readFileSync` è già importato dal golden TD01 nello stesso file — non duplicare l'import.)

Run: `node --import tsx --test src/shared/fattura-xml.test.ts` → tutto verde.

- [ ] **Step 6: Commit**

```bash
git add src/shared/fattura-xml.ts src/shared/fattura-xml.test.ts src/shared/__fixtures__/nota-credito-golden.xml
git commit -m "feat(fatture): buildFatturaXml ramo TD04 (sign=-1 + DatiFattureCollegate) + golden NC"
```

---

## Task 4: Endpoint `POST /api/fatture/:id/nota-credito`

**Files:**
- Modify: `src/server/routes/fatture.ts`
- Test: `src/server/routes/fatture.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/server/routes/fatture.test.ts` (riusa `J`, `makeApp`, `clienteCompleto`, `setCedente` già presenti; e `createBozza` per fare l'originale):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — `/:id/nota-credito` ritorna 404.

- [ ] **Step 3: Write minimal implementation**

In `src/server/routes/fatture.ts` estendi gli import e aggiungi l'handler (dopo `/:id/annulla-pagamento`, prima di `/:id/xml`):

```ts
// import: estendi l'import esistente da '@shared/schemas' aggiungendo NotaCreditoCreateInput:
//   import { FatturaCreateInput, FatturaUpdateInput, NotaCreditoCreateInput } from '@shared/schemas';
// e aggiungi (solo isNCDateValid: computeStorno arriva nel Task 5):
import { isNCDateValid } from '@shared/nc-sync';
```

```ts
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
  if (!isNCDateValid(body.data, orig.data)) {
    throw new HttpError(422, 'NC_DATA_ANTERIORE', `La data NC (${body.data}) non può precedere l'originale (${orig.data})`);
  }

  const id = randomUUID();
  const values: typeof fatture.$inferInsert = {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS (esistenti + 3 nuovi). Poi `npx tsc -p tsconfig.server.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): POST /:id/nota-credito (crea NC bozza TD04 legata, snapshot copiato)"
```

---

## Task 5: Estendi `/invia` con il side-effect storno (TD04)

**Files:**
- Modify: `src/server/routes/fatture.ts` (handler `/:id/invia`)
- Test: `src/server/routes/fatture.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/server/routes/fatture.test.ts`:

```ts
async function creaEInviaNC(app: any, headers: any, origId: string, prezzo: number, data = '2026-04-01') {
  const nc = await (await app.request(`/api/fatture/${origId}/nota-credito`, {
    method: 'POST', headers: J(headers), body: JSON.stringify({ data, righe: [{ descrizione: 'Storno', prezzoUnitario: prezzo }] }),
  })).json() as any;
  await app.request(`/api/fatture/${nc.id}/invia`, { method: 'POST', headers });
  return nc;
}

test('invia NC totale → originale stornata, NC tipoStorno totale', async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — la NC totale non porta l'originale a `stornata` (side-effect assente).

- [ ] **Step 3: Write minimal implementation**

Prima estendi l'import di nc-sync in `src/server/routes/fatture.ts` per includere `computeStorno`:
```ts
import { isNCDateValid, computeStorno } from '@shared/nc-sync';
```

Poi, nell'handler `/:id/invia`, **dopo** il blocco di numerazione (dopo `if (updated.length === 0) { ... throw 409 }`) e **prima** del `const [row] = await db.select()...` finale, inserisci il side-effect storno:

```ts
  // Side-effect NC TD04: applica lo storno all'originale (idempotente).
  if (f.tipoDocumento === 'TD04' && f.fatturaOriginaleId) {
    await db.transaction(async (tx) => {
      const [orig] = await tx.select().from(fatture)
        .where(and(eq(fatture.id, f.fatturaOriginaleId!), eq(fatture.profileId, profileId))).limit(1);
      if (!orig) return; // originale cancellato (FK set null): niente storno
      const res = computeStorno({
        originaleImporto: orig.importo,
        originaleStato: orig.stato,
        originaleNcIds: parseJson<string[]>(orig.ncIds, []),
        originaleNcTotaleImporto: orig.ncTotaleImporto,
        ncId: f.id,
        ncImporto: f.importo,
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
        .where(and(eq(fatture.id, f.id), eq(fatture.profileId, profileId)));
    });
  }
```

> `parseJson` è già definito nel file (5A). `f` è la fattura letta a inizio handler (ha `tipoDocumento`, `fatturaOriginaleId`, `importo`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS. Poi `npx tsc -p tsconfig.server.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): /invia applica nc-sync storno all'originale per le NC TD04"
```

---

## Task 6: Estendi `GET /:id/xml` per TD04 (carica originale)

**Files:**
- Modify: `src/server/routes/fatture.ts` (handler `/:id/xml`)
- Test: `src/server/routes/fatture.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/server/routes/fatture.test.ts`:

```ts
test('GET /:id/xml — NC TD04 → XML con TD04, importi negativi, DatiFattureCollegate', async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — l'XML della NC esce come TD01 (importi positivi, no DatiFattureCollegate).

- [ ] **Step 3: Write minimal implementation**

Nell'handler `/:id/xml`, prima di costruire `input`, carica l'originale se la fattura è TD04; poi passa `tipoDocumento` e `fatturaOriginale` a `input`. Sostituisci il blocco che costruisce e usa `input`:

```ts
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
```

> `toPublic` ritorna già `tipoDocumento`. Il resto dell'handler (`validateFatturaForXml`, `buildFatturaXml`, header) resta invariato.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS. Poi `npx tsc -p tsconfig.server.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): GET /:id/xml genera TD04 (carica originale per DatiFattureCollegate)"
```

---

## Task 7: Frontend — Crea NC + badge storno

**Files:**
- Modify: `src/client/lib/fatture-api.ts`
- Modify: `src/client/pages/fatture.ts`

- [ ] **Step 1: Aggiungi createNotaCredito al client**

In `src/client/lib/fatture-api.ts`, append (riusa `api` e i tipi già importati; aggiungi il tipo `NotaCreditoCreateInput` all'import da `@shared/types`):

```ts
import type { NotaCreditoCreateInput } from '@shared/types';

export function createNotaCredito(fatturaId: string, input: NotaCreditoCreateInput): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${fatturaId}/nota-credito`, input);
}
```

- [ ] **Step 2: Bottone "Crea NC" + badge nella pagina**

In `src/client/pages/fatture.ts`:

(a) Estendi l'import da `../lib/fatture-api` aggiungendo `createNotaCredito`.

(b) In `rowHtml`, dopo il calcolo di `xmlBtn`, aggiungi il bottone NC per le fatture TD01 numerate non ancora stornate, e un badge per lo stato storno. Sostituisci il blocco `azioni` (versione 5B) con:

```ts
    const xmlBtn = f.stato !== 'bozza'
      ? `<button class="btn btn-ghost" data-xml="${esc(f.id)}" title="Scarica XML">XML</button>`
      : '';
    const ncBtn = (f.tipoDocumento === 'TD01' && (f.stato === 'inviata' || f.stato === 'pagata'))
      ? `<button class="btn btn-ghost" data-nc="${esc(f.id)}" title="Crea nota di credito">NC</button>`
      : '';
    const azioni = f.stato === 'bozza'
      ? `<button class="btn btn-ghost" data-invia="${esc(f.id)}" title="Segna inviata">✉</button>
         <button class="btn btn-ghost" data-del="${esc(f.id)}" title="Elimina" style="color:var(--red);">✕</button>`
      : f.stato === 'inviata'
        ? `${xmlBtn}${ncBtn}<button class="btn btn-ghost" data-paga="${esc(f.id)}" title="Segna pagata">€</button>`
        : `${xmlBtn}${ncBtn}`;
```

(c) In `rowHtml`, modifica la cella stato per mostrare il badge: sostituisci `<span style="color:var(--text-muted);">${esc(stato)}</span>` con:

```ts
        <span style="color:var(--text-muted);">${f.tipoDocumento === 'TD04' ? 'NC ' : ''}${esc(stato)}${f.ncTotaleImporto > 0 && f.stato !== 'stornata' ? ` · stornato ${eur(f.ncTotaleImporto)}` : ''}</span>
```

> Aggiungi `ncTotaleImporto` al tipo `FatturaPublic` se assente: lo schema `FatturaPublic` in `@shared/schemas.ts` NON espone `ncTotaleImporto`/`tipoStorno`/`fatturaOriginaleId`. Aggiungili (vedi sotto, step d) per usarli nel client.

(d) In `src/shared/schemas.ts`, nel `FatturaPublic`, aggiungi i campi NC (dopo `numeroDisplay`):
```ts
  fatturaOriginaleId: z.string().nullable(),
  tipoStorno: z.string().nullable(),
  ncTotaleImporto: z.number(),
```
E in `src/server/routes/fatture.ts`, in `toPublic`, aggiungi (dopo `numeroDisplay: row.numeroDisplay,`):
```ts
    fatturaOriginaleId: row.fatturaOriginaleId,
    tipoStorno: row.tipoStorno,
    ncTotaleImporto: row.ncTotaleImporto,
```

(e) In `renderList`, dopo l'handler `[data-xml]`, cabla il bottone NC che apre un modal prefillato con le righe dell'originale:

```ts
    ul.querySelectorAll<HTMLButtonElement>('[data-nc]').forEach((b) => b.addEventListener('click', () => {
      const f = fatture.find((x) => x.id === b.dataset.nc);
      if (f) openNotaCreditoModal(f);
    }));
```

(f) Aggiungi la funzione `openNotaCreditoModal` accanto a `openFatturaModal`:

```ts
  function openNotaCreditoModal(orig: FatturaPublic): void {
    const righeInit = orig.righe.length ? orig.righe : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }];
    const handle = openModal({
      title: `Nota di credito su ${orig.numeroDisplay ?? ''}`,
      bodyHtml: `
        <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
          <p style="color:var(--text-muted);">Storno di ${esc(orig.numeroDisplay ?? '')} — ${esc(clienteNome(orig))}. Riduci gli importi per uno storno parziale.</p>
          <div class="form-row"><label>Data *</label>
            <input class="input" type="date" data-data value="${esc(orig.data)}" /></div>
          <div><label>Righe</label>
            <div data-righe style="display:flex;flex-direction:column;gap:var(--space-2);">${righeInit.map((r) => rigaInputs(r)).join('')}</div></div>
          <div style="text-align:right;font-weight:600;">Totale storno: <span data-totale>—</span></div>
          <p class="form-error" data-error hidden></p>
          <button type="submit" class="btn btn-primary">Crea nota di credito</button>
        </form>`,
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        root.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.addEventListener('input', () => recalcTotale(root)));
        recalcTotale(root);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          try {
            await createNotaCredito(orig.id, {
              data: root.querySelector<HTMLInputElement>('[data-data]')!.value,
              righe: readRighe(root),
            } as never);
            close(); await refresh();
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Errore creazione NC';
            errorEl.hidden = false;
          }
        });
      },
    });
    activeModalClose = handle.close;
  }
```

> `rigaInputs`, `readRighe`, `recalcTotale`, `clienteNome`, `activeModalClose` esistono già in `pages/fatture.ts` (5A). La NC creata è una bozza TD04: appare in lista e si invia col bottone ✉ come ogni bozza.

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.server.json --noEmit && npm run build`
Expected: typecheck client+server puliti; build OK.

- [ ] **Step 4: Commit**

```bash
git add src/shared/schemas.ts src/server/routes/fatture.ts src/client/lib/fatture-api.ts src/client/pages/fatture.ts
git commit -m "feat(client): crea Nota di Credito da fattura + badge storno; toPublic espone campi NC"
```

---

## Task 8: Docs + verifica finale

**Files:**
- Modify: `docs/migration-plan.md`

- [ ] **Step 1: Aggiorna migration-plan**

In `docs/migration-plan.md`, Fase 5, sostituisci la riga della state machine (5A) e aggiungi la NC. Cambia:

```markdown
- [x] State machine bozza → inviata → pagata (+ annulla-pagamento); NC TD04 → stornata rinviata a 5C (Slice 5A, 2026-06-08)
```

con:

```markdown
- [x] State machine bozza → inviata → pagata (+ annulla-pagamento) (Slice 5A, 2026-06-08)
- [x] Note di Credito TD04 + storno parziale/totale → stornata + XML TD04 (Slice 5C, 2026-06-09)
```

- [ ] **Step 2: Suite intera + typecheck + build**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.server.json --noEmit && npm run build`
Expected: tutti i test verdi (270 di 5B + nuovi nc-sync/schema/xml-td04/endpoint), entrambi i typecheck puliti, build OK. Annota il nuovo totale.

- [ ] **Step 3: Commit**

```bash
git add docs/migration-plan.md
git commit -m "docs: Fase 5 Note di Credito TD04 completata (Slice 5C)"
```

- [ ] **Step 4: Definition of Done (spec §9)**

Conferma: nc-sync puro (parziale/totale/idempotente/tolleranza/edge) ✓; `NotaCreditoCreateInput` ✓; `POST /:id/nota-credito` (409/422/200, snapshot copiato) ✓; `/invia` nc-sync atomico ✓; `buildFatturaXml` TD04 (sign=-1, DatiFattureCollegate) + golden ✓; `GET /:id/xml` TD04 ✓; frontend Crea NC + badge ✓; suite/typecheck/build verdi ✓.

---

## Note per l'esecutore

- **Run from repo root** (`C:\Users\matti\Documents\Progetti\Lira\Lira`). Singolo test: `node --import tsx --test <file>`.
- **`noUncheckedIndexedAccess`**: usa `arr[0]!`/guard.
- **Nessuna nuova dipendenza**; nessuna migration (campi NC già a schema da 5A).
- **Segno importi**: in DB la NC ha `importo` positivo (somma righe); il segno negativo è SOLO nell'XML TD04 (`sign=-1`). `computeStorno` usa `Math.abs`.
- **Idempotenza storno**: `computeStorno` non raddoppia se `ncId` è già in `ncIds`. Il side-effect di `/invia` è quindi sicuro su retry.
- **Numerazione condivisa**: la NC prende il prossimo progressivo della sequenza `(profilo, anno)` come ogni fattura (registro unico). Si invia col normale `/invia`.
- **Golden TD04**: rigenerare il fixture solo se il formato XML cambia intenzionalmente; è il guard contro riordini XSD (scarto SdI 00400).
- **Audit fix**: data NC ≥ originale (R6), DatiFattureCollegate.Data ISO (C8), Natura N2.2 forfettario anche su NC.
```
