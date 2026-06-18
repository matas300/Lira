# Dichiarazione 6B — Modelli F24 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla dichiarazione un blocco read-only "Modelli F24" che proietta saldo (anno N) e acconti (anno N+1) di imposta sostitutiva e contributi INPS variabili nei codici tributo/causali del modello F24, raggruppati per scadenza (30/06/N+1 e 30/11/N+1).

**Architecture:** Funzione pura `buildF24(scenario, ys, year)` nel motore dichiarazione esistente. Gli acconti su N+1 sono **ricalcolati** dalla base `imposta(N)` riusando gli helper del tax-engine (`buildAccontoPlan`, `buildContributiAccontoPlan`) — single source of logic, nessun fetch extra. Date via `@shared/date-rules`. Il frontend renderizza i moduli read-only sotto i quadri LM/RR.

**Tech Stack:** TypeScript strict, Node `--test`, Hono, Vite vanilla DOM. Nessuna migration.

**Spec:** `docs/superpowers/specs/2026-06-18-dichiarazione-6b-f24-design.md`

---

## File Structure

- `src/server/lib/dichiarazione-engine.ts` — tipi F24, `inpsCausale`, `buildF24`, `buildF24Warnings`, estensione `DichiarazioneYsView`, wiring in `buildDichiarazione`.
- `src/server/lib/dichiarazione-engine.test.ts` — test F24 (helper, core, warnings, golden, edge) + fix fixture `ysBase`.
- `src/server/routes/dichiarazione.ts` — popola i due nuovi campi `ys` (`inpsCategoria`, `prorogaSaldoAt`).
- `src/client/pages/dichiarazione.ts` — `renderF24`, sostituzione blocco placeholder in `renderPage`.
- `src/client/styles/index.css` — poche regole `.dich-f24-*`.

---

## Task 1: Tipi F24 + helper `inpsCausale`

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Write the failing test**

In testa al file di test, aggiungi l'import del nuovo helper alla riga di import esistente:

```ts
import { buildQuadroLM, buildQuadroRR, buildQuadroRX, buildQuadroRS } from './dichiarazione-engine';
import { buildFrontespizio, buildWarnings, buildDichiarazione } from './dichiarazione-engine';
import { inpsCausale } from './dichiarazione-engine';
```

Aggiungi in fondo al file:

```ts
test('inpsCausale: artigiani/commercianti/gestione separata', () => {
  assert.equal(inpsCausale('gestione_separata', null), 'P10');
  assert.equal(inpsCausale('artigiani_commercianti', 'commerciante'), 'CP');
  assert.equal(inpsCausale('artigiani_commercianti', 'artigiano'), 'AP');
  assert.equal(inpsCausale('artigiani_commercianti', null), 'AP'); // default artigiano
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `inpsCausale` non esportata / non definita.

- [ ] **Step 3: Write minimal implementation**

In `dichiarazione-engine.ts`, aggiungi i tipi dopo `export interface QuadroRR { … }` (prima di `export interface Dichiarazione`):

```ts
export type F24Sezione = 'erario' | 'inps';
export interface F24Riga {
  sezione: F24Sezione;
  codice: string; // '1792' | '1790' | '1791' | 'AP' | 'CP' | 'P10'
  descrizione: string;
  annoRiferimento: number;
  importo: number; // sempre > 0 (le righe a 0 sono omesse)
}
export interface F24Modulo {
  scadenza: string;          // ISO, post proroga/rolling
  scadenzaOriginale: string; // ISO canonica (30/06 o 30/11 di N+1)
  prorogaApplied: boolean;
  righe: F24Riga[];
  totale: number;
}
```

Aggiungi `f24` al tipo `Dichiarazione`:

```ts
export interface Dichiarazione {
  frontespizio: Frontespizio;
  quadroLM: Rigo[];
  quadroRR: QuadroRR;
  quadroRX: Rigo[];
  quadroRS: Rigo[];
  f24: F24Modulo[];
  warnings: DichiarazioneWarning[];
}
```

Aggiungi l'helper (in fondo, sopra `buildDichiarazione`):

```ts
/** Causale contributo INPS per la sezione INPS dell'F24 (contributi variabili). */
export function inpsCausale(inpsMode: string, inpsCategoria: string | null): string {
  if (inpsMode === 'gestione_separata') return 'P10';
  return inpsCategoria === 'commerciante' ? 'CP' : 'AP';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS per `inpsCausale`. (Altri test potrebbero rompersi sul tipo `Dichiarazione.f24` mancante in `buildDichiarazione` — verrà sistemato in Task 4; se il typecheck del test blocca tutto, prosegui: il fix è in Task 4. Per isolare, puoi temporaneamente eseguire solo questo file con `node --test --import tsx src/server/lib/dichiarazione-engine.test.ts` se disponibile, altrimenti procedi a Task 2–4 e poi lancia `npm test`.)

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): tipi F24 + helper inpsCausale"
```

---

## Task 2: Funzione pura `buildF24`

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Aggiorna l'import del test:

```ts
import { inpsCausale, buildF24 } from './dichiarazione-engine';
```

Aggiungi i test (usano `fakeScenario` e `ysBase` già definiti nel file; `ysBase` verrà esteso in Task 4, ma per ora passiamo un oggetto inline completo):

```ts
const ys2025 = {
  regime: 'forfettario', inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  impostaSostitutiva: 0.15, coefficiente: 0.67, limiteForfettario: 85000, prorogaSaldoAt: null,
} as const;

test('buildF24: due moduli 30/06 e 30/11 dell\'anno N+1', () => {
  // scenario default: substituteTax 2415, taxSaldo 1415, contributiVariabiliDovuti 1200, contributionSaldo 0
  const mods = buildF24(fakeScenario(), { ...ys2025 }, 2025);
  assert.equal(mods.length, 2);

  const giugno = mods[0]!;
  assert.equal(giugno.scadenzaOriginale, '2026-06-30');
  assert.equal(giugno.scadenza, '2026-06-30'); // 30/06/2026 è martedì, nessun rolling
  assert.equal(giugno.prorogaApplied, false);
  // saldo sostitutiva (anno 2025) + acconto 1 (anno 2026); INPS saldo 0 omesso, INPS acc1 600
  assert.deepEqual(giugno.righe.map((r) => [r.sezione, r.codice, r.annoRiferimento, r.importo]), [
    ['erario', '1792', 2025, 1415],
    ['erario', '1790', 2026, 1207.5],
    ['inps', 'AP', 2026, 600],
  ]);
  assert.equal(giugno.totale, 3222.5);

  const nov = mods[1]!;
  assert.equal(nov.scadenzaOriginale, '2026-11-30');
  assert.equal(nov.scadenza, '2026-11-30'); // 30/11/2026 è lunedì, nessun rolling
  assert.deepEqual(nov.righe.map((r) => [r.sezione, r.codice, r.annoRiferimento, r.importo]), [
    ['erario', '1791', 2026, 1207.5],
    ['inps', 'AP', 2026, 600],
  ]);
  assert.equal(nov.totale, 1807.5);
});

test('buildF24: acconto base è imposta(N) lorda, NON il saldo', () => {
  // substituteTax 2415 → acconti 1207.5/1207.5, indipendenti da taxSaldo 1415
  const mods = buildF24(fakeScenario({ taxSaldo: 1 }), { ...ys2025 }, 2025);
  const acc1 = mods[0]!.righe.find((r) => r.codice === '1790')!;
  assert.equal(acc1.importo, 1207.5);
});

test('buildF24: saldo INPS valorizzato compare in sezione INPS anno N', () => {
  const mods = buildF24(fakeScenario({ contributionSaldo: 350 }), { ...ys2025 }, 2025);
  const inpsSaldo = mods[0]!.righe.find((r) => r.sezione === 'inps' && r.annoRiferimento === 2025)!;
  assert.equal(inpsSaldo.codice, 'AP');
  assert.equal(inpsSaldo.importo, 350);
});

test('buildF24: banda unico-novembre (51,65 ≤ imposta < 257,52) → acc1=0 omesso, acc2 pieno', () => {
  const mods = buildF24(fakeScenario({ substituteTax: 100, taxSaldo: 0, contributiVariabiliDovuti: 0, contributionSaldo: 0 }), { ...ys2025 }, 2025);
  // giugno: nessun acconto sostitutiva (first=0), nessun saldo (0) → modulo vuoto omesso
  // novembre: acconto unico 100
  assert.equal(mods.length, 1);
  assert.equal(mods[0]!.scadenzaOriginale, '2026-11-30');
  assert.deepEqual(mods[0]!.righe.map((r) => [r.codice, r.importo]), [['1791', 100]]);
});

test('buildF24: imposta sotto soglia (<51,65) e niente saldo → nessun modulo', () => {
  const mods = buildF24(fakeScenario({ substituteTax: 40, taxSaldo: 0, contributiVariabiliDovuti: 0, contributionSaldo: 0 }), { ...ys2025 }, 2025);
  assert.equal(mods.length, 0);
});

test('buildF24: gestione separata usa causale P10 e acconto 80% (40/40)', () => {
  const mods = buildF24(
    fakeScenario({ contributiVariabiliDovuti: 1000, contributionSaldo: 0 }),
    { ...ys2025, inpsMode: 'gestione_separata', inpsCategoria: null },
    2025,
  );
  const inpsAcc1 = mods[0]!.righe.find((r) => r.sezione === 'inps')!;
  assert.equal(inpsAcc1.codice, 'P10');
  assert.equal(inpsAcc1.importo, 400); // 1000 × 40%
  const inpsAcc2 = mods[1]!.righe.find((r) => r.sezione === 'inps')!;
  assert.equal(inpsAcc2.importo, 400);
});

test('buildF24: proroga sposta solo il 30/06, non il 30/11', () => {
  const mods = buildF24(fakeScenario(), { ...ys2025, prorogaSaldoAt: '2026-07-31' }, 2025);
  assert.equal(mods[0]!.scadenza, '2026-07-31');
  assert.equal(mods[0]!.prorogaApplied, true);
  assert.equal(mods[1]!.scadenza, '2026-11-30');
  assert.equal(mods[1]!.prorogaApplied, false);
});

test('buildF24: regime non forfettario → nessun modulo', () => {
  const mods = buildF24(fakeScenario(), { ...ys2025, regime: 'ordinario' }, 2025);
  assert.equal(mods.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildF24` non definita.

- [ ] **Step 3: Write minimal implementation**

In `dichiarazione-engine.ts`, aggiungi l'import in testa (dopo l'import del type ForfettarioScenario):

```ts
import type { ForfettarioScenario } from './tax-engine';
import { buildAccontoPlan, buildContributiAccontoPlan } from './tax-engine';
import { buildRolledDueDate } from '@shared/date-rules';
```

Aggiungi i builder e la funzione (dopo `inpsCausale`):

```ts
const F24_ERARIO = { saldo: '1792', acc1: '1790', acc2: '1791' } as const;

function f24Riga(sezione: F24Sezione, codice: string, descrizione: string, annoRiferimento: number, importo: number): F24Riga {
  return { sezione, codice, descrizione, annoRiferimento, importo: r2(importo) };
}

interface ResolvedDue { scadenza: string; prorogaApplied: boolean; }
function resolveGiugno(year: number, prorogaSaldoAt: string | null): ResolvedDue {
  if (prorogaSaldoAt) return { scadenza: prorogaSaldoAt, prorogaApplied: true };
  return { scadenza: buildRolledDueDate(`${year + 1}-06-30`).date, prorogaApplied: false };
}

/**
 * Moduli F24 da dichiarazione (anno d'imposta N → versamenti N+1):
 * 30/06/N+1 = saldo sostitutiva (anno N) + acconto 1 (anno N+1) + saldo/acconto1 INPS;
 * 30/11/N+1 = acconto 2 (anno N+1) + acconto 2 INPS.
 * Acconti N+1 RICALCOLATI sulla base imposta(N)/contributi(N). Righe a 0 omesse;
 * moduli senza righe non emessi.
 */
export function buildF24(s: ForfettarioScenario, ys: DichiarazioneYsView, year: number): F24Modulo[] {
  if (ys.regime !== 'forfettario') return [];

  const taxAcc = buildAccontoPlan(s.substituteTax);
  const gestione = ys.inpsMode === 'gestione_separata' ? 'gestione_separata' : 'artigiani_commercianti';
  const inpsAcc = buildContributiAccontoPlan(s.contributiVariabiliDovuti, gestione);
  const causale = inpsCausale(ys.inpsMode, ys.inpsCategoria);

  const giugnoBase = `${year + 1}-06-30`;
  const novembreBase = `${year + 1}-11-30`;
  const giugno = resolveGiugno(year, ys.prorogaSaldoAt);
  const novembre = buildRolledDueDate(novembreBase);

  const righeGiugno = [
    f24Riga('erario', F24_ERARIO.saldo, 'Imposta sostitutiva — saldo', year, s.taxSaldo),
    f24Riga('erario', F24_ERARIO.acc1, 'Imposta sostitutiva — acconto 1ª rata', year + 1, taxAcc.first),
    f24Riga('inps', causale, 'Contributi INPS variabili — saldo', year, s.contributionSaldo),
    f24Riga('inps', causale, 'Contributi INPS variabili — acconto 1ª rata', year + 1, inpsAcc.first),
  ].filter((r) => r.importo > 0);

  const righeNovembre = [
    f24Riga('erario', F24_ERARIO.acc2, 'Imposta sostitutiva — acconto 2ª rata', year + 1, taxAcc.second),
    f24Riga('inps', causale, 'Contributi INPS variabili — acconto 2ª rata', year + 1, inpsAcc.second),
  ].filter((r) => r.importo > 0);

  const moduli: F24Modulo[] = [];
  if (righeGiugno.length) {
    moduli.push({
      scadenza: giugno.scadenza, scadenzaOriginale: giugnoBase, prorogaApplied: giugno.prorogaApplied,
      righe: righeGiugno, totale: r2(righeGiugno.reduce((a, r) => a + r.importo, 0)),
    });
  }
  if (righeNovembre.length) {
    moduli.push({
      scadenza: novembre.date, scadenzaOriginale: novembreBase, prorogaApplied: false,
      righe: righeNovembre, totale: r2(righeNovembre.reduce((a, r) => a + r.importo, 0)),
    });
  }
  return moduli;
}
```

Estendi `DichiarazioneYsView` (la modifica completa è in Task 4 con il fix dei fixture, ma i nuovi campi servono qui per il typecheck — aggiungili ora):

```ts
export interface DichiarazioneYsView {
  regime: string;
  inpsMode: string;
  inpsCategoria: string | null;
  impostaSostitutiva: number;
  coefficiente: number;
  limiteForfettario: number;
  prorogaSaldoAt: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS sui test `buildF24:*`. (I test 6A esistenti che costruiscono `ysBase`/`DichiarazioneYsView` ora falliscono il typecheck per i campi mancanti → sistemati in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): buildF24 — moduli saldo(N)+acconti(N+1) con codici tributo"
```

---

## Task 3: Warning F24

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Aggiorna import:

```ts
import { inpsCausale, buildF24, buildF24Warnings } from './dichiarazione-engine';
```

Aggiungi:

```ts
test('buildF24Warnings: sede INPS mancante quando ci sono moduli', () => {
  const mods = buildF24(fakeScenario(), { ...ys2025 }, 2025);
  const w = buildF24Warnings(mods, fakeScenario(), { ...ys2025 });
  assert.ok(w.some((x) => x.code === 'F24_INPS_SEDE_MANCANTE' && x.severity === 'info'));
});

test('buildF24Warnings: acconti sotto soglia segnalati (imposta 0<x<51,65)', () => {
  const s = fakeScenario({ substituteTax: 40, taxSaldo: 0, contributiVariabiliDovuti: 0, contributionSaldo: 0 });
  const mods = buildF24(s, { ...ys2025 }, 2025);
  const w = buildF24Warnings(mods, s, { ...ys2025 });
  assert.ok(w.some((x) => x.code === 'F24_ACCONTI_SOTTO_SOGLIA' && x.severity === 'info'));
});

test('buildF24Warnings: regime non forfettario → nessun warning F24', () => {
  const w = buildF24Warnings([], fakeScenario(), { ...ys2025, regime: 'ordinario' });
  assert.equal(w.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildF24Warnings` non definita.

- [ ] **Step 3: Write minimal implementation**

In `dichiarazione-engine.ts`, dopo `buildF24`:

```ts
/** Warning specifici dell'F24 (info, non bloccanti). */
export function buildF24Warnings(
  f24: F24Modulo[], s: ForfettarioScenario, ys: DichiarazioneYsView,
): DichiarazioneWarning[] {
  const w: DichiarazioneWarning[] = [];
  if (ys.regime !== 'forfettario') return w;
  const taxAcc = buildAccontoPlan(s.substituteTax);
  if (s.substituteTax > 0 && taxAcc.total === 0) {
    w.push({ code: 'F24_ACCONTI_SOTTO_SOGLIA', severity: 'info', message: 'Imposta sostitutiva sotto la soglia di 51,65 €: nessun acconto dovuto per l\'anno successivo.' });
  }
  if (f24.length > 0) {
    w.push({ code: 'F24_INPS_SEDE_MANCANTE', severity: 'info', message: 'Prospetto di calcolo: sede e matricola INPS non sono incluse, quindi l\'F24 non è pronto per la trasmissione.' });
  }
  return w;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS sui test `buildF24Warnings:*`.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): warning F24 (acconti sotto soglia, sede INPS mancante)"
```

---

## Task 4: Wiring in `buildDichiarazione` + fix fixture 6A

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts:186-195` (corpo `buildDichiarazione`)
- Test: `src/server/lib/dichiarazione-engine.test.ts:77-80` (fixture `ysBase`)

- [ ] **Step 1: Write the failing test**

Aggiorna il fixture `ysBase` (riga ~77) per includere i due nuovi campi:

```ts
const ysBase: DichiarazioneYsView = {
  regime: 'forfettario', inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  impostaSostitutiva: 0.15, coefficiente: 0.67, limiteForfettario: 85000, prorogaSaldoAt: null,
};
```

Aggiungi un test che verifica che `buildDichiarazione` popoli `f24` e includa i warning F24:

```ts
test('buildDichiarazione: include f24 e i warning F24', () => {
  const d = buildDichiarazione(input());
  assert.equal(d.f24.length, 2);
  assert.ok(d.warnings.some((w) => w.code === 'F24_INPS_SEDE_MANCANTE'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `d.f24` undefined (lunghezza 0/undefined) o typecheck su `Dichiarazione.f24`.

- [ ] **Step 3: Write minimal implementation**

In `dichiarazione-engine.ts`, sostituisci il corpo di `buildDichiarazione`:

```ts
export function buildDichiarazione(inp: DichiarazioneInput): Dichiarazione {
  const f24 = buildF24(inp.scenario, inp.ys, inp.year);
  return {
    frontespizio: buildFrontespizio(inp),
    quadroLM: buildQuadroLM(inp.scenario),
    quadroRR: buildQuadroRR(inp.scenario, inp.ys.inpsMode),
    quadroRX: buildQuadroRX(),
    quadroRS: buildQuadroRS(),
    f24,
    warnings: [...buildWarnings(inp), ...buildF24Warnings(f24, inp.scenario, inp.ys)],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — TUTTI i test del file (6A + 6B) verdi.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): buildDichiarazione emette f24 + warning; fixture ysView esteso"
```

---

## Task 5: Endpoint popola `inpsCategoria` + `prorogaSaldoAt`

**Files:**
- Modify: `src/server/routes/dichiarazione.ts:67-73`

- [ ] **Step 1: Write the failing test**

Cerca un test d'integrazione esistente per il route dichiarazione:

Run: `git ls-files | grep -i "dichiarazione.*test\|routes.*test"`

Se esiste `src/server/routes/dichiarazione.test.ts`, aggiungi un caso che asserisce `body.dichiarazione.f24.length > 0` per un anno configurato (segui il pattern di setup degli altri route test). Se NON esiste un test di route per dichiarazione, salta direttamente a Step 3 (la copertura del motore in Task 1–4 è sufficiente; il route fa solo wiring di 2 campi) e annota qui:

> Nessun route test dedicato per dichiarazione: il wiring è coperto dai test del motore + verifica manuale runtime.

- [ ] **Step 2: Run test to verify it fails (se applicabile)**

Run: `npm test`
Expected: FAIL se hai aggiunto il test (f24 vuoto perché `inpsCategoria`/`prorogaSaldoAt` non passati ancora). Altrimenti N/A.

- [ ] **Step 3: Write minimal implementation**

In `src/server/routes/dichiarazione.ts`, sostituisci il blocco `const ys: DichiarazioneYsView = { … };`:

```ts
  const ys: DichiarazioneYsView = {
    regime: ysRow.regime,
    inpsMode: ysRow.inpsMode,
    inpsCategoria: ysRow.inpsCategoria ?? null,
    impostaSostitutiva: Number(ysRow.impostaSostitutiva),
    coefficiente: Number(ysRow.coefficiente),
    limiteForfettario: Number(ysRow.limiteForfettario ?? 85000),
    prorogaSaldoAt: ysRow.prorogaSaldoAt ?? null,
  };
```

(I campi `inpsCategoria` e `prorogaSaldoAt` esistono già sulla riga `yearSettings` — verificali con `git grep "inpsCategoria\|prorogaSaldoAt" src/server/db/schema.ts`; sono usati anche da `scadenziario`.)

- [ ] **Step 4: Run test to verify it passes / typecheck**

Run: `npm test`
Expected: PASS. Inoltre verifica il typecheck server: `npx tsc -p tsconfig.server.json --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/dichiarazione.ts
git commit -m "feat(dichiarazione): route passa inpsCategoria + prorogaSaldoAt alla ys view (F24)"
```

---

## Task 6: Frontend — render moduli F24

**Files:**
- Modify: `src/client/pages/dichiarazione.ts`
- Modify: `src/client/styles/index.css:139` (dopo `.dich-cta`)

- [ ] **Step 1: Implementa il render (no unit test client in questo repo)**

Questo repo non ha test DOM per le pagine client (vedi gli altri `pages/*.ts`): la verifica è via typecheck + runtime. Procedi all'implementazione.

In `src/client/pages/dichiarazione.ts`, aggiorna l'import dei tipi:

```ts
import type { Dichiarazione, Frontespizio, Rigo, DichiarazioneWarning, F24Modulo } from '@server/lib/dichiarazione-engine';
```

Aggiungi un helper data + il render F24 (dopo `renderWarnings`):

```ts
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export function renderF24(moduli: F24Modulo[]): string {
  if (!moduli.length) return '';
  const sezione = (titolo: string, righe: F24Modulo['righe']): string => {
    if (!righe.length) return '';
    const rows = righe.map((r) =>
      `<div class="dich-row"><span class="dich-row-k">${esc(r.codice)} · ${esc(r.descrizione)} <span class="dich-src">rif. ${esc(r.annoRiferimento)}</span></span>`
      + `<span class="dich-row-v">${esc(eur(r.importo))}</span></div>`,
    ).join('');
    return `<div class="dich-f24-sez"><h4>${esc(titolo)}</h4>${rows}</div>`;
  };
  const cards = moduli.map((m) => {
    const erario = m.righe.filter((r) => r.sezione === 'erario');
    const inps = m.righe.filter((r) => r.sezione === 'inps');
    const proroga = m.prorogaApplied ? ' <span class="dich-src">proroga</span>' : '';
    return `<div class="card dich-card dich-f24-mod">
      <h3>F24 — scadenza ${esc(fmtDate(m.scadenza))}${proroga}</h3>
      ${sezione('Erario', erario)}
      ${sezione('INPS', inps)}
      <div class="dich-row dich-f24-tot"><span class="dich-row-k">Totale modulo</span><span class="dich-row-v">${esc(eur(m.totale))}</span></div>
    </div>`;
  }).join('');
  return `<div class="dich-f24">
    <div class="card dich-card"><h3>Modelli F24</h3>
      <p class="dich-note">Versamenti da dichiarazione: saldo dell'anno d'imposta + acconti per l'anno successivo. Prospetto di calcolo (sede/matricola INPS escluse).</p>
    </div>
    ${cards}
  </div>`;
}
```

In `renderPage`, sostituisci il blocco placeholder `<div class="card dich-card dich-cta">…</div>` con:

```ts
    ${renderF24(d.f24)}
```

- [ ] **Step 2: CSS**

In `src/client/styles/index.css`, dopo la riga `.dich-cta { … }`, aggiungi:

```css
.dich-f24 { display: flex; flex-direction: column; gap: 12px; }
.dich-f24-sez { margin-top: 8px; }
.dich-f24-sez h4 { margin: 0 0 4px; font-size: .78rem; color: var(--text2); text-transform: uppercase; letter-spacing: .04em; }
.dich-f24-tot { margin-top: 6px; border-top: 2px solid var(--color-border); font-weight: 700; }
.dich-f24-tot .dich-row-k { color: var(--text); font-weight: 700; }
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit` (client) e `npm run build`
Expected: nessun errore di tipo; build ok.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/dichiarazione.ts src/client/styles/index.css
git commit -m "feat(client): blocco Modelli F24 read-only nella pagina Dichiarazione"
```

---

## Task 7: Golden test consolidamento + verifica finale

**Files:**
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Golden esplicito commerciante + gestione separata coerenti**

Aggiungi un test che blocca i numeri di entrambi i rami INPS in un colpo (documenta i codici attesi):

```ts
test('GOLDEN F24: commerciante usa CP, importi bloccati', () => {
  const s = fakeScenario({ substituteTax: 3000, taxSaldo: 1200, contributiVariabiliDovuti: 800, contributionSaldo: 200 });
  const mods = buildF24(s, { ...ys2025, inpsCategoria: 'commerciante' }, 2025);
  // giugno: 1792=1200(2025), 1790=1500(2026), CP saldo=200(2025), CP acc1=400(2026)
  assert.deepEqual(mods[0]!.righe.map((r) => [r.codice, r.annoRiferimento, r.importo]), [
    ['1792', 2025, 1200], ['1790', 2026, 1500], ['CP', 2025, 200], ['CP', 2026, 400],
  ]);
  assert.equal(mods[0]!.totale, 3300);
  // novembre: 1791=1500(2026), CP acc2=400(2026)
  assert.deepEqual(mods[1]!.righe.map((r) => [r.codice, r.annoRiferimento, r.importo]), [
    ['1791', 2026, 1500], ['CP', 2026, 400],
  ]);
  assert.equal(mods[1]!.totale, 1900);
});
```

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: PASS — tutti i test verdi (648 preesistenti + nuovi 6B). Nota: `scadenziario-service.test.ts` può risultare flaky in run parallela su Windows (vedi reference temp libsql); rilancia in isolamento se serve.

- [ ] **Step 3: Typecheck completo**

Run: `npx tsc -p tsconfig.server.json --noEmit && npx tsc -p tsconfig.json --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/server/lib/dichiarazione-engine.test.ts
git commit -m "test(dichiarazione): golden F24 commerciante (codici + importi bloccati)"
```

---

## Self-review note (autore del piano)

- **Copertura spec:** mappa temporale (Task 2), ricalcolo acconti N+1 (Task 2), codici/causali (Task 1+2), proroga/rolling (Task 2), warning (Task 3), endpoint (Task 5), frontend (Task 6), golden + edge (Task 2, 7). ✔
- **Acconto base = `substituteTax` (imposta lorda N)**, non `taxSaldo`: esplicitato nel test "acconto base è imposta(N) lorda". ✔
- **Naming coerente:** `F24Riga/F24Modulo/F24Sezione`, `buildF24`, `buildF24Warnings`, `inpsCausale`, campo `f24` usati identici in tutti i task. ✔
- **Nessuna migration:** `inpsCategoria` e `prorogaSaldoAt` già nello schema (usati da scadenziario) — Task 5 li legge soltanto. ✔
- **Rischio dipendenza Task 1↔4:** i tipi introdotti in Task 1 rendono `Dichiarazione.f24` obbligatorio prima che `buildDichiarazione` lo popoli (Task 4). Eseguire i Task in ordine; `npm test` torna verde solo da fine Task 4 in poi. Annotato negli step.
