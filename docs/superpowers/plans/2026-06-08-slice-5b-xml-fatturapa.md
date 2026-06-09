# Slice 5B — XML FatturaPA TD01 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generare e scaricare l'XML FatturaPA v1.2 (TipoDocumento TD01) di una fattura numerata di Lira, con validazione fail-fast del cedente e dei dati fattura, portando la logica audit-hardened di CalcoliVari in moduli TypeScript puri.

**Architecture:** Generatore puro `@shared/fattura-xml.ts` (helpers + `buildFatturaXml`) + lettore/validatore cedente puro `@shared/cedente.ts`, riusati da un endpoint `GET /api/fatture/:id/xml` (pattern route 5A) che blocca con 404/422 prima di produrre XML invalido. Frontend: bottone "Scarica XML" sulle fatture numerate. Nessuna modifica allo schema DB.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Hono, Drizzle (libSQL), Zod, Vite vanilla TS, Node `--test`.

**Porting source (CalcoliVari, sola lettura di riferimento):**
- `CalcoliVari/fatture-xml-helpers.js` — helpers puri (sanitizeXmlLatin1, modalitaToCodiceMP, sanitizeProgressivoInvio, buildAnagraficaXml).
- `CalcoliVari/fatture-docs-feature.js:1718-2044` — `buildFatturaElettronicaXml` + sub-helpers e `validateFatturaForXml:1639`.
- `CalcoliVari/html-utils.js` — `xmlEscape`.

**Reference patterns (Lira, leggere prima):**
- `src/server/routes/fatture.ts` — route 5A, `toPublic`, `HttpError`, scoping `activeProfileId`, `parseJson`, `regimeFor`, `annoFromData`.
- `src/server/routes/fatture.test.ts` — harness `makeApp()` (createTestDb + createUserWithDefaultProfile + createSession + insert cliente).
- `src/shared/fattura-logic.ts` — `SOGLIA_BOLLO`, stile modulo puro `@shared`.
- `src/shared/validators.ts` — `isValidPartitaIvaIT`, `isValidCodiceFiscaleFormat`.
- `src/client/pages/fatture.ts` — `rowHtml`/`renderList`, azioni inline, `esc()`.

**Conventions:** TS strict (`arr[0]!` o guard). ESM. Nessun side-effect globale. Errori via `HttpError(status, code, message, details?)` + `errorHandler`. Niente nuove dipendenze.

**Adattamenti rispetto alla sorgente CalcoliVari (deliberati):**
- **Solo TD01**: rimossi i rami NC/TD04 (`sign`, `_validateNCDate`, `DatiFattureCollegate`). Sempre importi positivi.
- **Cedente** da lettore tipizzato `@shared/cedente.ts`, non da `getProfileFiscalData()` (DOM/state CalcoliVari).
- **Cessionario**: Lira `cliente_snapshot` ha solo `nome` (no nome/cognome separati) e chiave `codiceSdi` (non `codiceSDI`) → `buildAnagraficaCessionario` emette sempre `<Denominazione>` da `nome`.
- **Contributo integrativo**: come CalcoliVari, **bloccato** (errore) se `> 0` (gestione separata INPS non lo prevede; cassa autonoma non supportata in 5B). Audit A3.
- **IBAN / DataScadenzaPagamento / Causale**: non rilevanti per lo schema Lira 5B → omessi.

**Test runner note:** `npm test` esegue tutta la suite. Singolo file: `node --import tsx --test src/path/file.test.ts`.

---

## Task 1: Helpers XML puri — `@shared/fattura-xml.ts` (parte helpers)

Port degli helpers puri da `fatture-xml-helpers.js` + `xmlEscape` da `html-utils.js`. Il builder arriva nel Task 4 (stesso file).

**Files:**
- Create: `src/shared/fattura-xml.ts`
- Test: `src/shared/fattura-xml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/fattura-xml.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  xmlEscape, fmtXmlNum, parseMaybeNumber, sanitizeXmlLatin1,
  sanitizeProgressivoInvio, modalitaToCodiceMP, regimeToRF, buildAnagraficaCessionario,
} from './fattura-xml';

test('xmlEscape — entità XML (apostrofo come &apos;)', () => {
  assert.equal(xmlEscape(`A & B <x> "q" 'z'`), 'A &amp; B &lt;x&gt; &quot;q&quot; &apos;z&apos;');
  assert.equal(xmlEscape(null), '');
});

test('fmtXmlNum — 2 decimali', () => {
  assert.equal(fmtXmlNum(1000), '1000.00');
  assert.equal(fmtXmlNum(10.005), '10.01');
  assert.equal(fmtXmlNum('x' as unknown as number), '0.00');
});

test('parseMaybeNumber — virgola decimale e fallback 0', () => {
  assert.equal(parseMaybeNumber('1,5'), 1.5);
  assert.equal(parseMaybeNumber(''), 0);
  assert.equal(parseMaybeNumber(3), 3);
});

test('sanitizeXmlLatin1 — smart quotes/euro/strip fuori Latin-1', () => {
  assert.equal(sanitizeXmlLatin1('“ciao”'), '"ciao"');   // “ciao” → "ciao"
  assert.equal(sanitizeXmlLatin1('10€'), '10EUR');            // 10€ → 10EUR
  assert.equal(sanitizeXmlLatin1('café'), 'café');       // café preservato (Latin-1)
  assert.equal(sanitizeXmlLatin1('A中B'), 'AB');               // A中B → AB (CJK strip)
});

test('sanitizeProgressivoInvio — <=10 alfanumerici', () => {
  assert.equal(sanitizeProgressivoInvio('2026/1'), '20261');
  assert.equal(sanitizeProgressivoInvio(''), '00001');
  assert.equal(sanitizeProgressivoInvio('ABCDEFGHIJKLMNO'), 'ABCDEFGHIJ');
});

test('modalitaToCodiceMP — mappa + default bonifico', () => {
  assert.equal(modalitaToCodiceMP('Bonifico bancario'), 'MP05');
  assert.equal(modalitaToCodiceMP('contanti'), 'MP10');
  assert.equal(modalitaToCodiceMP(null), 'MP05');
});

test('regimeToRF — RF19 forfettario / RF01 ordinario', () => {
  assert.equal(regimeToRF('forfettario'), 'RF19');
  assert.equal(regimeToRF('ordinario'), 'RF01');
  assert.equal(regimeToRF('boh'), 'RF19');
});

test('buildAnagraficaCessionario — Denominazione da nome, sanitize+escape', () => {
  assert.equal(buildAnagraficaCessionario({ nome: 'ACME & Co' }), '<Denominazione>ACME &amp; Co</Denominazione>');
  assert.equal(buildAnagraficaCessionario({ nome: '' }), '<Denominazione></Denominazione>');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: FAIL — `Cannot find module './fattura-xml'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/fattura-xml.ts
//
// Generatore FatturaPA v1.2 (TD01) puro — port audit-hardened da CalcoliVari
// (fatture-xml-helpers.js + fatture-docs-feature.js). Nessuna dipendenza DOM/DB.
// Solo TD01 (no note di credito): importi sempre positivi.

import { SOGLIA_BOLLO } from './fattura-logic';

export const XML_NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';

/** Escape XML (apostrofo -> &apos;, come html-utils.xmlEscape). */
export function xmlEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function fmtXmlNum(n: number): string {
  return round2(Number(n) || 0).toFixed(2);
}

export function parseMaybeNumber(value: unknown): number {
  const n = parseFloat(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Conformità XSD String*LatinType (Basic Latin + Latin-1 Supplement). NFC +
 * mappatura smart-quotes/dash/euro/ellissi -> ASCII/Latin-1; strip del resto
 * (control chars tranne \t \n \r, CJK, emoji). Usa \u-escape per evitare di
 * incorporare byte di controllo letterali nel sorgente.
 */
export function sanitizeXmlLatin1(value: unknown): string {
  if (value == null) return '';
  let str = String(value);
  if (typeof str.normalize === 'function') str = str.normalize('NFC');
  return str
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')   // control chars (keep \t \n \r)
    .replace(/[‘’‚‛′]/g, "'")          // smart single quotes / prime
    .replace(/[“”„‟″]/g, '"')          // smart double quotes
    .replace(/[‐‑‒–—―]/g, '-')    // hyphens / dashes
    .replace(/…/g, '...')                                  // ellipsis
    .replace(/€/g, 'EUR')                                  // euro sign
    .replace(/•/g, '-')                                    // bullet
    .replace(/™/g, '(TM)')                                 // trademark
    .replace(/[^\x00-\xFF]/g, '');                              // strip rest (CJK, emoji)
}

/** ProgressivoInvio: <=10 char alfanumerici (FatturaPA 1.1.2). */
export function sanitizeProgressivoInvio(value: unknown): string {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || '00001';
}

const MODALITA_TO_MP: Record<string, string> = {
  'bonifico': 'MP05', 'bonifico bancario': 'MP05', 'assegno': 'MP01',
  'assegno circolare': 'MP02', 'contanti': 'MP10', 'carta di credito': 'MP08',
  'carta': 'MP08', 'paypal': 'MP08', 'rid': 'MP09', 'sepa': 'MP15',
  'giroconto': 'MP06', 'compensazione': 'MP07',
};

/** Stringa libera -> codice ModalitaPagamento (default MP05 bonifico). */
export function modalitaToCodiceMP(str: unknown): string {
  const key = String(str || '').toLowerCase().trim();
  for (const k of Object.keys(MODALITA_TO_MP)) {
    if (key.indexOf(k) !== -1) return MODALITA_TO_MP[k]!;
  }
  return 'MP05';
}

export function regimeToRF(regime: string): 'RF19' | 'RF01' {
  return regime === 'ordinario' ? 'RF01' : 'RF19';
}

/**
 * Anagrafica cessionario. Lo snapshot Lira ha solo `nome` (denominazione o
 * nome+cognome già concatenati) -> emettiamo sempre <Denominazione>.
 */
export function buildAnagraficaCessionario(cliente: { nome?: string | null }): string {
  const denom = sanitizeXmlLatin1(cliente?.nome || '').trim().slice(0, 80);
  return '<Denominazione>' + xmlEscape(denom) + '</Denominazione>';
}

export { SOGLIA_BOLLO };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: PASS (8 test).

- [ ] **Step 5: Commit**

```bash
git add src/shared/fattura-xml.ts src/shared/fattura-xml.test.ts
git commit -m "feat(fatture): helpers XML FatturaPA puri (escape, sanitize Latin-1, MP, RF, anagrafica)"
```

---

## Task 2: Lettore + validatore cedente — `@shared/cedente.ts`

Mappa i JSON di profilo (`anagrafica` + `attivita`) + regime in un `Cedente` tipizzato, con **fail-fast** (audit A2: P.IVA cedente bloccante).

**Files:**
- Create: `src/shared/cedente.ts`
- Test: `src/shared/cedente.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/cedente.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCedenteFromProfile, type Cedente } from './cedente';

const anagraficaOk = {
  cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
  residenza: { indirizzo: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI' },
};
const attivitaOk = { partita_iva: '00743110157' };

test('readCedenteFromProfile — profilo completo -> cedente', () => {
  const r = readCedenteFromProfile({ anagrafica: anagraficaOk, attivita: attivitaOk, regime: 'forfettario' });
  assert.ok('cedente' in r);
  const c = (r as { cedente: Cedente }).cedente;
  assert.equal(c.partitaIva, '00743110157');
  assert.equal(c.nome, 'Mario');
  assert.equal(c.cognome, 'Rossi');
  assert.equal(c.cap, '20100');
  assert.equal(c.provincia, 'MI');
  assert.equal(c.regime, 'forfettario');
});

test('readCedenteFromProfile — P.IVA mancante -> errori (audit A2)', () => {
  const r = readCedenteFromProfile({ anagrafica: anagraficaOk, attivita: {}, regime: 'forfettario' });
  assert.ok('errors' in r);
  assert.ok((r as { errors: string[] }).errors.some((e) => /P\.IVA/i.test(e)));
});

test('readCedenteFromProfile — sede incompleta -> errori elencati', () => {
  const r = readCedenteFromProfile({
    anagrafica: { ...anagraficaOk, residenza: { indirizzo: '', cap: '', citta: '', provincia: '' } },
    attivita: attivitaOk, regime: 'forfettario',
  });
  assert.ok('errors' in r);
  const errs = (r as { errors: string[] }).errors;
  assert.ok(errs.some((e) => /indirizzo/i.test(e)));
  assert.ok(errs.some((e) => /CAP/i.test(e)));
});

test('readCedenteFromProfile — né denominazione né nome+cognome -> errore', () => {
  const r = readCedenteFromProfile({
    anagrafica: { ...anagraficaOk, nome: '', cognome: '' },
    attivita: attivitaOk, regime: 'forfettario',
  });
  assert.ok('errors' in r);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/cedente.test.ts`
Expected: FAIL — `Cannot find module './cedente'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/cedente.ts
//
// Lettura tipizzata del cedente/prestatore dai JSON di profilo Lira
// (profiles.anagrafica + profiles.attivita) + regime (year_settings).
// Fail-fast: nessun XML con cedente incompleto (audit A2).

import { isValidPartitaIvaIT } from './validators';

export interface Cedente {
  partitaIva: string;
  codiceFiscale: string;
  nome: string;
  cognome: string;
  indirizzo: string;
  cap: string;
  comune: string;
  provincia: string;
  nazione: string;
  regime: 'forfettario' | 'ordinario';
}

interface ProfileParts {
  anagrafica: unknown;
  attivita: unknown;
  regime: string;
}

function s(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export function readCedenteFromProfile(p: ProfileParts): { cedente: Cedente } | { errors: string[] } {
  const a = (p.anagrafica && typeof p.anagrafica === 'object' ? p.anagrafica : {}) as Record<string, unknown>;
  const att = (p.attivita && typeof p.attivita === 'object' ? p.attivita : {}) as Record<string, unknown>;
  const res = (a.residenza && typeof a.residenza === 'object' ? a.residenza : {}) as Record<string, unknown>;

  const cedente: Cedente = {
    partitaIva: s(att.partita_iva).replace(/\s+/g, ''),
    codiceFiscale: s(a.cf).toUpperCase(),
    nome: s(a.nome),
    cognome: s(a.cognome),
    indirizzo: s(res.indirizzo),
    cap: s(res.cap),
    comune: s(res.citta),
    provincia: s(res.provincia).toUpperCase().slice(0, 2),
    nazione: 'IT',
    regime: p.regime === 'ordinario' ? 'ordinario' : 'forfettario',
  };

  const errors: string[] = [];
  if (!isValidPartitaIvaIT(cedente.partitaIva)) {
    errors.push('P.IVA del cedente mancante o non valida (11 cifre, check-digit) - completa l\'anagrafica di profilo.');
  }
  if (!cedente.indirizzo) errors.push('Indirizzo del cedente mancante nell\'anagrafica di profilo.');
  if (!/^\d{5}$/.test(cedente.cap)) errors.push('CAP del cedente mancante o non valido (5 cifre).');
  if (!cedente.comune) errors.push('Comune del cedente mancante nell\'anagrafica di profilo.');
  if (!/^[A-Z]{2}$/.test(cedente.provincia)) errors.push('Provincia del cedente mancante o non valida (2 lettere).');
  if (!cedente.nome && !cedente.cognome) errors.push('Nome/Cognome (o denominazione) del cedente mancanti.');

  return errors.length ? { errors } : { cedente };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/cedente.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/shared/cedente.ts src/shared/cedente.test.ts
git commit -m "feat(fatture): lettore cedente tipizzato + fail-fast (audit A2)"
```

---

## Task 3: Validatore fattura per XML — `validateFatturaForXml`

Aggiunge a `@shared/fattura-xml.ts` il validatore della fattura (numero, importo, contributo integrativo, cliente, ritenuta forfettario) + i tipi `FatturaXmlInput`/`ClienteSnapshotXml`. Ritorna `string[]` (vuoto = ok).

**Files:**
- Modify: `src/shared/fattura-xml.ts`
- Test: `src/shared/fattura-xml.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/shared/fattura-xml.test.ts`:

```ts
import { validateFatturaForXml, type FatturaXmlInput } from './fattura-xml';

const cedenteX = {
  partitaIva: '00743110157', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
  indirizzo: 'Via Roma 1', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT',
  regime: 'forfettario' as const,
};
const clienteIT = {
  nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', codiceFiscale: null,
  codiceSdi: '0000000', pec: null, indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino',
  provincia: 'TO', nazione: 'IT',
};
function inputBase(): FatturaXmlInput {
  return {
    cedente: cedenteX, cliente: clienteIT, numero: '2026/1', data: '2026-03-01',
    righe: [{ descrizione: 'Consulenza', quantita: 1, prezzoUnitario: 1000 }],
    importo: 1000, ritenuta: 0, aliquotaRitenuta: null, tipoRitenuta: null, causaleRitenuta: null,
    marcaDaBollo: true, bolloAddebitato: false, modalitaPagamento: 'bonifico', contributoIntegrativo: 0,
  };
}

test('validateFatturaForXml — input valido -> nessun errore', () => {
  assert.deepEqual(validateFatturaForXml(inputBase()), []);
});

test('validateFatturaForXml — contributo integrativo > 0 -> errore (A3)', () => {
  const errs = validateFatturaForXml({ ...inputBase(), contributoIntegrativo: 50 });
  assert.ok(errs.some((e) => /integrativo/i.test(e)));
});

test('validateFatturaForXml — ritenuta in forfettario -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), ritenuta: 50 });
  assert.ok(errs.some((e) => /ritenuta/i.test(e)));
});

test('validateFatturaForXml — cliente IT senza P.IVA né CF -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cliente: { ...clienteIT, partitaIva: null, codiceFiscale: null } });
  assert.ok(errs.some((e) => /P\.IVA|Codice Fiscale/i.test(e)));
});

test('validateFatturaForXml — cliente PA con IPA non 6 char -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cliente: { ...clienteIT, tipoCliente: 'PA', codiceSdi: '123' } });
  assert.ok(errs.some((e) => /IPA/i.test(e)));
});

test('validateFatturaForXml — sede cliente incompleta -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cliente: { ...clienteIT, cap: '' } });
  assert.ok(errs.some((e) => /CAP/i.test(e)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: FAIL — `validateFatturaForXml` / `FatturaXmlInput` non esportati.

- [ ] **Step 3: Write minimal implementation**

In testa a `src/shared/fattura-xml.ts`, estendi gli import:

```ts
import { SOGLIA_BOLLO } from './fattura-logic';
import { isValidPartitaIvaIT, isValidCodiceFiscaleFormat } from './validators';
import type { Cedente } from './cedente';
```

Append a `src/shared/fattura-xml.ts`:

```ts
export interface ClienteSnapshotXml {
  nome?: string | null;
  tipoCliente?: string | null;
  partitaIva?: string | null;
  codiceFiscale?: string | null;
  codiceSdi?: string | null;
  pec?: string | null;
  indirizzo?: string | null;
  cap?: string | null;
  citta?: string | null;
  provincia?: string | null;
  nazione?: string | null;
}

export interface FatturaXmlInput {
  cedente: Cedente;
  cliente: ClienteSnapshotXml;
  numero: string;
  data: string;
  righe: Array<{ descrizione: string; quantita: number; prezzoUnitario: number }>;
  importo: number;
  ritenuta: number;
  aliquotaRitenuta: number | null;
  tipoRitenuta: string | null;
  causaleRitenuta: string | null;
  marcaDaBollo: boolean;
  bolloAddebitato: boolean;
  modalitaPagamento: string | null;
  contributoIntegrativo: number;
}

/** Helper stringa locale (trim, null-safe). Usato da validate + builder. */
function s(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Validazione fail-fast della fattura per l'XML. Ritorna [] se ok. */
export function validateFatturaForXml(input: FatturaXmlInput): string[] {
  const errors: string[] = [];
  if (!input.numero) errors.push('Numero fattura mancante (la fattura deve essere inviata).');
  if (!input.data) errors.push('Data fattura mancante.');
  if (!(Number(input.importo) > 0)) errors.push('Importo totale della fattura pari a zero.');
  if (Number(input.contributoIntegrativo) > 0) {
    errors.push('Contributo integrativo non supportato in XML (gestione separata INPS non lo prevede): azzera il campo.');
  }
  if (input.cedente.regime === 'forfettario' && Number(input.ritenuta) > 0) {
    errors.push('Regime forfettario esonerato dalla ritenuta d\'acconto (art. 1 c. 67 L. 190/2014): rimuovi la ritenuta.');
  }
  const c = input.cliente;
  if (!c || !s(c.nome)) {
    errors.push('Cliente senza denominazione.');
  } else {
    if (!s(c.indirizzo)) errors.push('Indirizzo del cliente mancante.');
    if (!s(c.cap)) errors.push('CAP del cliente mancante.');
    if (!s(c.citta)) errors.push('Comune del cliente mancante.');
    const naz = (s(c.nazione) || 'IT').toUpperCase();
    if (naz === 'IT') {
      const hasPiva = isValidPartitaIvaIT(s(c.partitaIva).replace(/\s+/g, ''));
      const hasCf = isValidCodiceFiscaleFormat(s(c.codiceFiscale).toUpperCase());
      if (!hasPiva && !hasCf) errors.push('Cliente IT senza P.IVA valida né Codice Fiscale: SdI rifiuterà l\'XML.');
    }
    if (c.tipoCliente === 'PA' && !/^[A-Z0-9]{6}$/i.test(s(c.codiceSdi))) {
      errors.push('Cliente PA: il Codice IPA deve essere 6 caratteri alfanumerici (D.M. 55/2013 art. 2).');
    }
  }
  return errors;
}
```

> `s()` è dichiarato qui (function declaration: hoisted, riusabile dal builder del Task 4 nello stesso file). Non ridefinirlo nel Task 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: PASS (8 helper + 6 validator).

- [ ] **Step 5: Commit**

```bash
git add src/shared/fattura-xml.ts src/shared/fattura-xml.test.ts
git commit -m "feat(fatture): validateFatturaForXml fail-fast (contributo, ritenuta, cliente IT/PA)"
```

---

## Task 4: Builder `buildFatturaXml` (TD01) — assembly

Port di `buildFatturaElettronicaXml` (solo TD01) in `@shared/fattura-xml.ts`.

**Files:**
- Modify: `src/shared/fattura-xml.ts`
- Test: `src/shared/fattura-xml.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/shared/fattura-xml.test.ts`:

```ts
import { buildFatturaXml } from './fattura-xml';

test('buildFatturaXml — struttura TD01 forfettario, N2.2, bollo, no ritenuta', () => {
  const xml = buildFatturaXml(inputBase());
  assert.match(xml, /versione="FPR12"/);
  assert.match(xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
  assert.match(xml, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(xml, /<Numero>2026\/1<\/Numero>/);
  assert.match(xml, /<Natura>N2\.2<\/Natura>/);
  assert.match(xml, /<DatiBollo>\s*<BolloVirtuale>SI<\/BolloVirtuale>\s*<ImportoBollo>2\.00<\/ImportoBollo>/);
  assert.ok(!/<DatiRitenuta>/.test(xml));            // forfettario: niente ritenuta
  assert.match(xml, /<ImponibileImporto>1000\.00<\/ImponibileImporto>/);
  assert.match(xml, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
});

test('buildFatturaXml — ordine elementi DatiGeneraliDocumento (TipoDoc->Divisa->Data->Numero->...->ImportoTotale)', () => {
  const xml = buildFatturaXml(inputBase());
  const iTipo = xml.indexOf('<TipoDocumento>');
  const iDivisa = xml.indexOf('<Divisa>');
  const iData = xml.indexOf('<Data>');
  const iNumero = xml.indexOf('<Numero>');
  const iTot = xml.indexOf('<ImportoTotaleDocumento>');
  assert.ok(iTipo < iDivisa && iDivisa < iData && iData < iNumero && iNumero < iTot, 'ordine elementi errato');
});

test('buildFatturaXml — cedente IdTrasmittente usa CF per persona fisica', () => {
  const xml = buildFatturaXml(inputBase());
  // CF 16-char nel cedente -> IdTrasmittente.IdCodice = CF (non P.IVA)
  assert.match(xml, /<IdTrasmittente>\s*<IdPaese>IT<\/IdPaese>\s*<IdCodice>RSSMRA80A01H501U<\/IdCodice>/);
});

test('buildFatturaXml — cliente PA usa IPA 6 come CodiceDestinatario; estero senza DatiPagamento', () => {
  const pa = buildFatturaXml({ ...inputBase(), cliente: { ...inputBase().cliente, tipoCliente: 'PA', codiceSdi: 'UF1234' } });
  assert.match(pa, /<CodiceDestinatario>UF1234<\/CodiceDestinatario>/);

  const estero = buildFatturaXml({
    ...inputBase(),
    cliente: { nome: 'Foreign Co', tipoCliente: 'Estero', partitaIva: 'DE123', codiceFiscale: null,
      codiceSdi: '', pec: null, indirizzo: 'Strasse 1', cap: '10115', citta: 'Berlin', provincia: '', nazione: 'DE' },
  });
  assert.match(estero, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(estero, /<Nazione>DE<\/Nazione>/);
  assert.ok(!/<DatiPagamento>/.test(estero)); // estero: niente DatiPagamento
});

test('buildFatturaXml — rimborso bollo addebitato -> riga + DatiRiepilogo N1', () => {
  const xml = buildFatturaXml({ ...inputBase(), bolloAddebitato: true });
  assert.match(xml, /<Descrizione>Rimborso imposta di bollo<\/Descrizione>/);
  assert.match(xml, /<Natura>N1<\/Natura>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: FAIL — `buildFatturaXml` non esportato.

- [ ] **Step 3: Write minimal implementation**

Append a `src/shared/fattura-xml.ts`:

```ts
function buildDettaglioLinee(input: FatturaXmlInput): { linee: string[]; rimborsoBollo: boolean } {
  let n = 0;
  const linee = input.righe.map((line) => {
    n++;
    const qta = parseMaybeNumber(line.quantita) || 1;
    const pu = round2(parseMaybeNumber(line.prezzoUnitario));
    const tot = round2(qta * pu);
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
  const rimborsoBollo = input.marcaDaBollo && input.bolloAddebitato && round2(input.importo) > SOGLIA_BOLLO;
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

function buildCessionarioFiscale(c: ClienteSnapshotXml): string {
  const naz = (s(c.nazione) || 'IT').slice(0, 2).toUpperCase();
  const estero = naz !== 'IT';
  const pivaRaw = s(c.partitaIva).replace(/\s+/g, '');
  const cf = s(c.codiceFiscale).toUpperCase();
  if (estero) {
    const vat = (pivaRaw || cf);
    if (!vat) return '';
    const codice = vat.replace(new RegExp('^' + naz, 'i'), '').trim() || vat;
    return '\n        <IdFiscaleIVA>\n          <IdPaese>' + naz + '</IdPaese>\n          <IdCodice>'
      + xmlEscape(codice) + '</IdCodice>\n        </IdFiscaleIVA>';
  }
  if (isValidPartitaIvaIT(pivaRaw)) {
    let out = '\n        <IdFiscaleIVA>\n          <IdPaese>IT</IdPaese>\n          <IdCodice>'
      + xmlEscape(pivaRaw) + '</IdCodice>\n        </IdFiscaleIVA>';
    if (cf) out += '\n        <CodiceFiscale>' + xmlEscape(cf) + '</CodiceFiscale>';
    return out;
  }
  if (!cf) return '';
  return '\n        <CodiceFiscale>' + xmlEscape(cf) + '</CodiceFiscale>';
}

/** Genera l'XML FatturaPA v1.2 TD01. Assume input già validato (validateFatturaForXml). */
export function buildFatturaXml(input: FatturaXmlInput): string {
  const ced = input.cedente;
  const c = input.cliente;
  const regimeFiscale = regimeToRF(ced.regime);
  const progressivo = sanitizeProgressivoInvio(input.numero);
  const piva = s(ced.partitaIva).replace(/\s+/g, '');

  // IdTrasmittente.IdCodice: per persona fisica (CF 16 char) usa il CF, non la
  // P.IVA (SdI scarta con 00300). Per PG il CF coincide con la P.IVA.
  const cf = s(ced.codiceFiscale).toUpperCase();
  const isPF = /^[A-Z0-9]{16}$/.test(cf);
  const trasmittenteIdCodice = isPF ? cf : piva;

  const naz = (s(c.nazione) || 'IT').slice(0, 2).toUpperCase();
  const estero = naz !== 'IT';
  const isPA = c.tipoCliente === 'PA';
  const pivaCli = s(c.partitaIva).replace(/\s+/g, '');
  const codiceSDI = estero
    ? 'XXXXXXX'
    : (isPA
        ? s(c.codiceSdi).toUpperCase()
        : (isValidPartitaIvaIT(pivaCli)
            ? (s(c.codiceSdi) || '0000000').padEnd(7, '0').slice(0, 7)
            : (s(c.codiceSdi) || '0000000')));

  const imponibile = round2(input.importo);
  const naturaLinea = 'N2.2';
  const riferimentoNormativo = "Regime forfettario: operazione in franchigia IVA e senza ritenuta d'acconto Art.1 c.54-89 L.190/2014";

  const { linee, rimborsoBollo } = buildDettaglioLinee(input);

  const datiBollo = (input.marcaDaBollo && imponibile > SOGLIA_BOLLO)
    ? '\n      <DatiBollo>\n        <BolloVirtuale>SI</BolloVirtuale>\n        <ImportoBollo>2.00</ImportoBollo>\n      </DatiBollo>'
    : '';

  // DatiGeneraliDocumento — ordine XSD: TipoDocumento, Divisa, Data, Numero, DatiBollo, ImportoTotaleDocumento
  const importoTotale = round2(input.importo + (rimborsoBollo ? 2 : 0));
  const dggParts: string[] = [];
  dggParts.push('<TipoDocumento>TD01</TipoDocumento>');
  dggParts.push('<Divisa>EUR</Divisa>');
  dggParts.push('<Data>' + xmlEscape(input.data) + '</Data>');
  dggParts.push('<Numero>' + xmlEscape(input.numero) + '</Numero>');
  if (datiBollo.trim()) dggParts.push(datiBollo.trim());
  dggParts.push('<ImportoTotaleDocumento>' + fmtXmlNum(importoTotale) + '</ImportoTotaleDocumento>');
  const datiGeneraliDocumentoXml = '<DatiGeneraliDocumento>' + dggParts.join('') + '</DatiGeneraliDocumento>';

  const cessionarioFiscaleXml = buildCessionarioFiscale(c);

  const cedInd = xmlEscape(sanitizeXmlLatin1(ced.indirizzo).slice(0, 60));
  const cedCap = s(ced.cap).replace(/\D/g, '').padStart(5, '0').slice(0, 5);
  const cedCom = xmlEscape(sanitizeXmlLatin1(ced.comune).slice(0, 60));
  const cedProv = s(ced.provincia).slice(0, 2).toUpperCase();
  const cedProvXml = cedProv ? '\n        <Provincia>' + xmlEscape(cedProv) + '</Provincia>' : '';
  const cfCedenteXml = cf ? '\n        <CodiceFiscale>' + xmlEscape(cf) + '</CodiceFiscale>' : '';

  const cliInd = xmlEscape(sanitizeXmlLatin1(c.indirizzo || '').slice(0, 60));
  const cliCap = estero
    ? (s(c.cap).replace(/\D/g, '').padStart(5, '0').slice(0, 5) || '00000')
    : s(c.cap).replace(/\D/g, '').padStart(5, '0').slice(0, 5);
  const cliCom = xmlEscape(sanitizeXmlLatin1(c.citta || '').slice(0, 60));
  const cliProv = estero ? '' : s(c.provincia).slice(0, 2).toUpperCase();
  const cliProvXml = cliProv ? '\n        <Provincia>' + xmlEscape(cliProv) + '</Provincia>' : '';

  const datiPagamento = estero ? '' : `
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>${modalitaToCodiceMP(input.modalitaPagamento)}</ModalitaPagamento>
        <ImportoPagamento>${fmtXmlNum(round2(importoTotale - (Number(input.ritenuta) || 0)))}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12"
  xmlns:p="${XML_NAMESPACE}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${XML_NAMESPACE} http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${xmlEscape(trasmittenteIdCodice)}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${progressivo}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${codiceSDI}</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>${xmlEscape(piva)}</IdCodice>
        </IdFiscaleIVA>${cfCedenteXml}
        <Anagrafica>
          <Nome>${xmlEscape(sanitizeXmlLatin1(ced.nome).slice(0, 60))}</Nome>
          <Cognome>${xmlEscape(sanitizeXmlLatin1(ced.cognome).slice(0, 60))}</Cognome>
        </Anagrafica>
        <RegimeFiscale>${regimeFiscale}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${cedInd}</Indirizzo>
        <CAP>${cedCap}</CAP>
        <Comune>${cedCom}</Comune>${cedProvXml}
        <Nazione>${ced.nazione}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>${cessionarioFiscaleXml}
        <Anagrafica>
          ${buildAnagraficaCessionario(c)}
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>${cliInd}</Indirizzo>
        <CAP>${cliCap}</CAP>
        <Comune>${cliCom}</Comune>${cliProvXml}
        <Nazione>${naz}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      ${datiGeneraliDocumentoXml}
    </DatiGenerali>
    <DatiBeniServizi>
${linee.join('\n')}
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>${naturaLinea}</Natura>
        <ImponibileImporto>${fmtXmlNum(imponibile)}</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>${xmlEscape(riferimentoNormativo)}</RiferimentoNormativo>
      </DatiRiepilogo>${rimborsoBollo ? `
      <DatiRiepilogo>
        <AliquotaIVA>0.00</AliquotaIVA>
        <Natura>N1</Natura>
        <ImponibileImporto>2.00</ImponibileImporto>
        <Imposta>0.00</Imposta>
        <RiferimentoNormativo>Rimborso imposta di bollo - Escluso art. 15 DPR 633/72 (Ris. AdE 444/E 2008)</RiferimentoNormativo>
      </DatiRiepilogo>` : ''}
    </DatiBeniServizi>${datiPagamento}
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/shared/fattura-xml.test.ts`
Expected: PASS (tutti i test: helper + validator + builder).
Poi: `npx tsc -p tsconfig.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/shared/fattura-xml.ts src/shared/fattura-xml.test.ts
git commit -m "feat(fatture): buildFatturaXml TD01 (cedente/cessionario, N2.2, bollo, IPA/estero, IdTrasmittente CF)"
```

---

## Task 5: Endpoint `GET /api/fatture/:id/xml`

Aggiunge l'handler a `routes/fatture.ts`: carica la fattura numerata, costruisce il cedente dal profilo (fail-fast), valida, genera, scarica.

**Files:**
- Modify: `src/server/routes/fatture.ts`
- Modify: `src/server/routes/fatture.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append a `src/server/routes/fatture.test.ts`. Il harness `makeApp` crea il profilo con anagrafica/attività vuote → i test settano un cedente valido e un cliente completo prima di generare.

```ts
import { profiles } from '../db/schema';
import { eq as eqDrizzle } from 'drizzle-orm';

async function setCedente(db: any, profileId: string) {
  await db.update(profiles).set({
    anagrafica: JSON.stringify({
      cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
      residenza: { indirizzo: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI' },
    }),
    attivita: JSON.stringify({ partita_iva: '00743110157' }),
  }).where(eqDrizzle(profiles.id, profileId));
}

async function clienteCompleto(db: any, profileId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(clienti).values({
    id, profileId, nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157',
    codiceSdi: '0000000', nazione: 'IT', indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO',
  });
  return id;
}

test('GET /:id/xml — fattura inviata -> 200 application/xml + filename', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  await app.request(`/api/fatture/${f.id}/invia`, { method: 'POST', headers });

  const r = await app.request(`/api/fatture/${f.id}/xml`, { headers });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /application\/xml/);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="IT00743110157_/);
  const xml = await r.text();
  assert.match(xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
  assert.match(xml, /<Numero>2026\/1<\/Numero>/);
});

test('GET /:id/xml — bozza -> 422 FATTURA_NON_NUMERATA', async () => {
  const { app, db, headers, profileId } = await makeApp();
  await setCedente(db, profileId);
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  const r = await app.request(`/api/fatture/${f.id}/xml`, { headers });
  assert.equal(r.status, 422);
  assert.equal(((await r.json()) as any).error.code, 'FATTURA_NON_NUMERATA');
});

test('GET /:id/xml — cedente incompleto -> 422 CEDENTE_INCOMPLETO con details', async () => {
  const { app, db, headers, profileId } = await makeApp(); // profilo senza anagrafica/attività
  const cId = await clienteCompleto(db, profileId);
  const f = await (await app.request('/api/fatture', {
    method: 'POST', headers: J(headers),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1000 }] }),
  })).json() as any;
  await app.request(`/api/fatture/${f.id}/invia`, { method: 'POST', headers });
  const r = await app.request(`/api/fatture/${f.id}/xml`, { headers });
  assert.equal(r.status, 422);
  const body = (await r.json()) as any;
  assert.equal(body.error.code, 'CEDENTE_INCOMPLETO');
  assert.ok(Array.isArray(body.error.details) && body.error.details.length > 0);
});

test('GET /:id/xml — id altro profilo -> 404', async () => {
  const { app: appA, db: dbA, headers: hA, profileId: pA } = await makeApp('a@x.it');
  const { app: appB, headers: hB } = await makeApp('b@x.it');
  await setCedente(dbA, pA);
  const cId = await clienteCompleto(dbA, pA);
  const f = await (await appA.request('/api/fatture', {
    method: 'POST', headers: J(hA),
    body: JSON.stringify({ clienteId: cId, data: '2026-03-01', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }),
  })).json() as any;
  const r = await appB.request(`/api/fatture/${f.id}/xml`, { headers: hB });
  assert.equal(r.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: FAIL — `/:id/xml` ritorna 404 (handler non definito).

- [ ] **Step 3: Write minimal implementation**

In `src/server/routes/fatture.ts` estendi gli import e aggiungi l'handler (dopo `/:id/annulla-pagamento`):

```ts
// estendi l'import esistente da '../db/schema' aggiungendo profiles:
//   import { fatture, clienti, yearSettings, profiles } from '../db/schema';
// e aggiungi:
import { readCedenteFromProfile } from '@shared/cedente';
import { buildFatturaXml, validateFatturaForXml, type FatturaXmlInput } from '@shared/fattura-xml';
```

```ts
/** Nome file SDI: IT<piva>_<progressivo 5 alfanum>. */
function xmlFilename(piva: string, numeroDisplay: string): string {
  const prog = String(numeroDisplay).replace(/[^A-Za-z0-9]/g, '').slice(-5).padStart(5, '0');
  return `IT${String(piva).replace(/\D/g, '')}_${prog}`;
}

// ─────────── GET /:id/xml ───────────
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
```

> **Type note:** `toPublic` (5A, post-review) include già `aliquotaRitenuta/tipoRitenuta/causaleRitenuta`. `pub.righe` è `Array<{descrizione,quantita,prezzoUnitario}>`. `pub.numeroDisplay` è `string | null`; dopo il guard `!f.numeroDisplay` l'asserzione `!` è sicura.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/server/routes/fatture.test.ts`
Expected: PASS (12 esistenti + 4 nuovi).
Poi: `npx tsc -p tsconfig.server.json --noEmit` → pulito.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/fatture.ts src/server/routes/fatture.test.ts
git commit -m "feat(fatture): GET /:id/xml — genera FatturaPA TD01 con fail-fast cedente/fattura"
```

---

## Task 6: Frontend — download XML

Aggiunge `downloadFatturaXml` al client e un bottone "XML" sulle fatture numerate.

**Files:**
- Modify: `src/client/lib/fatture-api.ts`
- Modify: `src/client/pages/fatture.ts`

- [ ] **Step 1: Aggiungi la funzione di download al client**

In `src/client/lib/fatture-api.ts`: cambia l'import in cima da `import { api } from './api';` a `import { api, ApiError } from './api';`, poi append:

```ts
/** Scarica l'XML FatturaPA della fattura. Su errore lancia ApiError col messaggio del server. */
export async function downloadFatturaXml(id: string): Promise<void> {
  const res = await fetch(`/api/fatture/${id}/xml`, { credentials: 'include' });
  if (!res.ok) {
    let code = 'HTTP_ERROR', message = `HTTP ${res.status}`;
    let details: unknown;
    try {
      const env = await res.json() as { error?: { code?: string; message?: string; details?: unknown } };
      code = env.error?.code ?? code; message = env.error?.message ?? message; details = env.error?.details;
    } catch { /* corpo non-JSON */ }
    const detailMsg = Array.isArray(details) && details.length ? `: ${(details as string[]).join('; ')}` : '';
    throw new ApiError(res.status, code, message + detailMsg, details);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const filename = m ? m[1]! : `fattura-${id}.xml`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Aggiungi il bottone "XML" sulle righe numerate**

In `src/client/pages/fatture.ts`:

Estendi l'import da `../lib/fatture-api`:
```ts
import {
  listFatture, createFattura, updateFattura, removeFattura,
  inviaFattura, pagaFattura, downloadFatturaXml,
} from '../lib/fatture-api';
```

Nella funzione `rowHtml`, sostituisci il blocco `const azioni = ...` con (aggiunge il bottone XML alle fatture numerate):

```ts
    const xmlBtn = f.stato !== 'bozza'
      ? `<button class="btn btn-ghost" data-xml="${esc(f.id)}" title="Scarica XML">XML</button>`
      : '';
    const azioni = f.stato === 'bozza'
      ? `<button class="btn btn-ghost" data-invia="${esc(f.id)}" title="Segna inviata">✉</button>
         <button class="btn btn-ghost" data-del="${esc(f.id)}" title="Elimina" style="color:var(--red);">✕</button>`
      : f.stato === 'inviata'
        ? `${xmlBtn}<button class="btn btn-ghost" data-paga="${esc(f.id)}" title="Segna pagata">€</button>`
        : xmlBtn;
```

In `renderList`, dopo gli handler `[data-del]`, cabla il bottone XML:

```ts
    ul.querySelectorAll<HTMLButtonElement>('[data-xml]').forEach((b) => b.addEventListener('click', async () => {
      try { await downloadFatturaXml(b.dataset.xml!); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore generazione XML'); }
    }));
```

(`ApiError` è già importato in `pages/fatture.ts` da `../lib/api`.)

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: typecheck pulito; build Vite OK.

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/fatture-api.ts src/client/pages/fatture.ts
git commit -m "feat(client): bottone Scarica XML sulle fatture numerate"
```

---

## Task 7: Docs + verifica finale

**Files:**
- Modify: `docs/migration-plan.md`

- [ ] **Step 1: Aggiorna migration-plan**

In `docs/migration-plan.md`, Fase 5, sostituisci:

```markdown
- [ ] Generazione XML FatturaPA v1.2 (TD01 + TD04) — porta logica da CalcoliVari
```

con:

```markdown
- [x] Generazione XML FatturaPA v1.2 (TD01) + download on-demand + fail-fast cedente (Slice 5B, 2026-06-08). TD04/NC -> 5C.
```

- [ ] **Step 2: Suite intera + typecheck + build**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.server.json --noEmit && npm run build`
Expected: tutti i test verdi (242 di 5A + nuovi fattura-xml/cedente/endpoint), entrambi i typecheck puliti, build OK. Annota il nuovo totale test.

- [ ] **Step 3: Commit**

```bash
git add docs/migration-plan.md
git commit -m "docs: Fase 5 XML FatturaPA TD01 completato (Slice 5B)"
```

- [ ] **Step 4: Definition of Done (spec §8)**

Conferma: helpers + builder TD01 con element-order/N2.2/no-ritenuta/bollo ✓; cedente fail-fast (audit A2) ✓; `validateFatturaForXml` (contributo A3, ritenuta, cliente IT/PA) ✓; copertura IT/PA/Estero ✓; endpoint 404/422/200 con header corretti ✓; bottone Scarica XML ✓; suite/typecheck/build verdi ✓.

---

## Note per l'esecutore

- **Run from repo root** (`C:\Users\matti\Documents\Progetti\Lira\Lira`). Singolo test: `node --import tsx --test <file>`.
- **Solo TD01**: nessun ramo NC. Sempre importi positivi.
- **`noUncheckedIndexedAccess`**: usa `arr[0]!`/guard (il codice fornito lo fa).
- **Nessuna nuova dipendenza**: solo DOM (`fetch`, `URL.createObjectURL`), Drizzle, Hono, helper esistenti.
- **Cedente incompleto sui profili di test**: il harness crea profili senza anagrafica/attività → i test che generano XML chiamano `setCedente()` prima. È il comportamento atteso (fail-fast), non un bug.
- **Element order XSD**: il rischio numero uno di scarto SdI. Il test "ordine elementi DatiGeneraliDocumento" lo blinda; non riordinare i campi del template.
- **Audit fix incorporati**: A2 (P.IVA cedente fail-fast), A3 (contributo integrativo bloccato), IdTrasmittente CF per PF (SdI 00300), IPA 6 char PA (D.M. 55/2013), Natura N2.2 forfettario, no DatiRitenuta forfettario.
```
