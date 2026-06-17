# Dichiarazione 6A — Quadri LM/RR/RX/RS (read-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire la dichiarazione forfettaria (frontespizio + quadri LM/RR/RX/RS) come vista read-only server-authoritative che mappa lo scenario fiscale già calcolato nei righi ufficiali, esposta da `GET /api/dichiarazione/:year` e renderizzata in `/dichiarazione`.

**Architecture:** Motore puro `dichiarazione-engine.ts` (no DB) che riceve un `ForfettarioScenario` già costruito + year-settings + anagrafica e produce i righi `{key,label,value,source}` + warning. Il route carica i dati (riusando `loadScenarioData` + `buildForfettarioMethodComparison`, come `/api/tax/scenario`), poi chiama il motore. La pagina client è read-only (pattern `regime.ts`: render puri + mount). Nessuna ri-matematica fiscale: si mappa lo scenario.

**Tech Stack:** TypeScript strict (noUncheckedIndexedAccess), Hono + Drizzle (solo I/O nel route), Vite vanilla DOM, Node `--test`.

---

## File Structure

- Create: `src/server/lib/dichiarazione-engine.ts` — motore puro: tipi + `buildQuadroLM`, `buildQuadroRR`, `buildQuadroRX`, `buildQuadroRS`, `buildFrontespizio`, `buildWarnings`, `buildDichiarazione`.
- Test: `src/server/lib/dichiarazione-engine.test.ts`.
- Create: `src/server/routes/dichiarazione.ts` — `GET /api/dichiarazione/:year`.
- Test: `src/server/routes/dichiarazione.test.ts`.
- Modify: `src/server/index.ts` — registra il route.
- Create: `src/client/pages/dichiarazione.ts` — render puri + mount.
- Test: `src/client/pages/dichiarazione.test.ts`.
- Modify: `src/client/main.ts` — route `/dichiarazione` → pagina reale.
- Modify: `src/client/styles/index.css` — stili `dich-*`.

Riferimenti (verificare prima di scrivere):
- `ForfettarioScenario` (campi) in `src/server/lib/tax-engine.ts:267-307`.
- `loadScenarioData` in `src/server/lib/scenario-data.ts:184`; `buildForfettarioMethodComparison` in `tax-engine.ts`; uso combinato in `src/server/routes/tax.ts:138-177`.
- `profiles` table (colonne `anagrafica`/`attivita` JSON) in `src/server/db/schema.ts:42-43`; `fetchYearSettings`/year-settings shape.
- Pattern route auth: `src/server/routes/scadenziario.ts` (usa `c.get('activeProfileId')`).
- Pattern pagina read-only: `src/client/pages/regime.ts`.

---

## Task 1: Motore — tipi + quadro LM

**Files:**
- Create: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/server/lib/dichiarazione-engine.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroLM } from './dichiarazione-engine';
import type { ForfettarioScenario } from './tax-engine';

// Scenario sintetico coi soli campi usati dal motore dichiarazione.
function fakeScenario(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  return {
    year: 2025, method: 'storico',
    grossCollected: 30000,
    forfettarioGrossIncome: 20100,        // 30000 × 0.67
    deductibleContributionsPaid: 4000,
    taxableBase: 16100,                   // 20100 − 4000
    substituteTax: 2415,                  // 16100 × 0.15
    taxSaldo: 1415,                       // dopo 1000 di acconti reali
    taxAccontoBase: 2415, taxAcconti: { acc1: 0, acc2: 0, total: 0 } as never,
    contributiVariabiliDovuti: 1200,
    contributionSaldo: 0, contributionAccontoBase: 0,
    contributionAcconti: { acc1: 0, acc2: 0, total: 0 } as never,
    forecastGrossCollected: 30000, forecastGrossIncome: 20100,
    forecastContributiVariabili: 1200, forecastTaxableBase: 16100, forecastSubstituteTax: 2415,
    previousFixedTail: 800, currentFixedWithinYear: 3200,
    previousContributionSaldo: 0, managedCashOutflows: 0,
    formula: [], explanation: [],
    ...over,
  };
}

test('buildQuadroLM: mappa i righi chiave dallo scenario', () => {
  const righi = buildQuadroLM(fakeScenario());
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('LM1').value, 30000);    // ricavi
  assert.equal(by('LM2').value, 20100);    // reddito lordo
  assert.equal(by('LM3').value, 4000);     // contributi deducibili
  assert.equal(by('LM4').value, 16100);    // netto
  assert.equal(by('LM34').value, 16100);   // imponibile
  assert.equal(by('LM36').value, 2415);    // imposta sostitutiva
  assert.equal(by('LM43').value, 1000);    // acconti = substituteTax − taxSaldo
  assert.equal(by('LM45').value, 1415);    // saldo a debito
  assert.equal(by('LM1').source, 'computed');
});

test('buildQuadroLM: acconti (LM43) mai negativi', () => {
  const righi = buildQuadroLM(fakeScenario({ substituteTax: 500, taxSaldo: 500 }));
  assert.equal(righi.find((r) => r.key === 'LM43')!.value, 0);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/server/lib/dichiarazione-engine.test.ts`
Expected: FAIL — `./dichiarazione-engine` non esiste.

- [ ] **Step 3: Implementare**

Create `src/server/lib/dichiarazione-engine.ts`:

```ts
// src/server/lib/dichiarazione-engine.ts
//
// Motore PURO della dichiarazione PF forfettaria (Redditi PF): mappa uno
// `ForfettarioScenario` GIÀ calcolato (tax-engine) nei righi dei quadri ufficiali
// LM/RR/RX/RS + frontespizio + warning. NON ricalcola la fiscalità (single source
// of truth = tax-engine): qui si mappa. Read-only (slice 6A); override e perdite
// pregresse arriveranno in 6C, F24 in 6B.
//
// Audit fiscale (vs CalcoliVari dichiarazione-engine.js): LM cassa art.1 c.64
// L.190/2014, RS informativo non deducibile, RX clamp credito, soglie 85k/100k,
// startup 5% art.1 c.65, ritenute forfettario = 0 (art.1 c.67). Aliquote INPS e
// acconti sono già year-aware nello scenario.

import type { ForfettarioScenario } from './tax-engine';

export type RigoSource = 'computed' | 'from-profile' | 'zero';
export interface Rigo {
  key: string;
  label: string;
  value: number;
  source: RigoSource;
}
export interface DichiarazioneWarning {
  code: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
}
export interface Frontespizio {
  codiceFiscale: string;
  cognome: string;
  nome: string;
  dataNascita: string;
  comune: string;
  provincia: string;
  annoImposta: number;
  regime: string; // 'RF19' forfettario
  tipoDichiarazione: string; // 'ordinaria'
}
export interface QuadroRR {
  sezione: 'gestione_separata' | 'artigiani_commercianti';
  righi: Rigo[];
}
export interface Dichiarazione {
  frontespizio: Frontespizio;
  quadroLM: Rigo[];
  quadroRR: QuadroRR;
  quadroRX: Rigo[];
  quadroRS: Rigo[];
  warnings: DichiarazioneWarning[];
}

export interface DichiarazioneAnagrafica {
  cf?: string; nome?: string; cognome?: string; data_nascita?: string;
  residenza?: { citta?: string; provincia?: string };
}
export interface DichiarazioneYsView {
  regime: string;
  inpsMode: string;
  impostaSostitutiva: number;
  coefficiente: number;
  limiteForfettario: number;
}
export interface DichiarazioneInput {
  year: number;
  scenario: ForfettarioScenario;
  ys: DichiarazioneYsView;
  anagrafica: DichiarazioneAnagrafica;
  dataInizioAttivita?: string;
}

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function rigo(key: string, label: string, value: number, source: RigoSource = 'computed'): Rigo {
  return { key, label, value: r2(value), source };
}

/** Quadro LM (forfettario): mappa reddito e imposta sostitutiva dallo scenario. */
export function buildQuadroLM(s: ForfettarioScenario): Rigo[] {
  const lm4 = Math.max(0, s.forfettarioGrossIncome - s.deductibleContributionsPaid);
  const accontiImputati = Math.max(0, s.substituteTax - s.taxSaldo);
  return [
    rigo('LM1', 'Ricavi/compensi percepiti', s.grossCollected),
    rigo('LM2', 'Reddito forfettario lordo (ricavi × coefficiente)', s.forfettarioGrossIncome),
    rigo('LM3', 'Contributi previdenziali deducibili (cassa)', s.deductibleContributionsPaid),
    rigo('LM4', 'Reddito al netto dei contributi', lm4),
    rigo('LM34', 'Reddito imponibile', s.taxableBase),
    rigo('LM36', 'Imposta sostitutiva', s.substituteTax),
    rigo('LM43', 'Acconti versati', accontiImputati),
    rigo('LM45', 'Imposta sostitutiva a debito (saldo)', s.taxSaldo),
  ];
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/server/lib/dichiarazione-engine.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(server): motore dichiarazione — tipi + quadro LM"
```

---

## Task 2: Motore — quadri RR / RX / RS

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Append i test**

In `src/server/lib/dichiarazione-engine.test.ts` aggiungere (riusa `fakeScenario`):

```ts
import { buildQuadroRR, buildQuadroRX, buildQuadroRS } from './dichiarazione-engine';

test('buildQuadroRR: gestione separata → contributi dovuti dai variabili, niente fissi', () => {
  const q = buildQuadroRR(fakeScenario(), 'gestione_separata');
  assert.equal(q.sezione, 'gestione_separata');
  const dovuti = q.righi.find((r) => r.key === 'RR_GS_DOVUTI')!;
  assert.equal(dovuti.value, 1200); // contributiVariabiliDovuti
  assert.ok(!q.righi.some((r) => r.key === 'RR_FISSI'));
});

test('buildQuadroRR: artigiani/commercianti → fissi + variabili + totale', () => {
  const q = buildQuadroRR(fakeScenario(), 'artigiani_commercianti');
  assert.equal(q.sezione, 'artigiani_commercianti');
  assert.equal(q.righi.find((r) => r.key === 'RR_FISSI')!.value, 4000); // 800 + 3200
  assert.equal(q.righi.find((r) => r.key === 'RR_VARIABILI')!.value, 1200);
  assert.equal(q.righi.find((r) => r.key === 'RR_TOTALE')!.value, 5200);
});

test('buildQuadroRX: credito anno prec a 0 (6A), source zero', () => {
  const righi = buildQuadroRX();
  assert.equal(righi.find((r) => r.key === 'RX1')!.value, 0);
  assert.equal(righi.find((r) => r.key === 'RX1')!.source, 'zero');
});

test('buildQuadroRS: vuoto in 6A (informativo, popolato in 6C)', () => {
  assert.deepEqual(buildQuadroRS(), []);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/server/lib/dichiarazione-engine.test.ts`
Expected: FAIL — funzioni non esistono.

- [ ] **Step 3: Implementare** — append in `src/server/lib/dichiarazione-engine.ts`:

```ts
/** Quadro RR (INPS): ramo gestione separata (sez. II) o artigiani/commercianti (sez. I). */
export function buildQuadroRR(s: ForfettarioScenario, inpsMode: string): QuadroRR {
  if (inpsMode === 'gestione_separata') {
    return {
      sezione: 'gestione_separata',
      righi: [
        rigo('RR_GS_BASE', 'Reddito imponibile previdenziale', s.forfettarioGrossIncome),
        rigo('RR_GS_DOVUTI', 'Contributi dovuti (gestione separata)', s.contributiVariabiliDovuti),
      ],
    };
  }
  const fissi = s.previousFixedTail + s.currentFixedWithinYear;
  const variabili = s.contributiVariabiliDovuti;
  return {
    sezione: 'artigiani_commercianti',
    righi: [
      rigo('RR_FISSI', 'Contributi sul minimale (quote fisse dell\'anno)', fissi),
      rigo('RR_VARIABILI', 'Contributi eccedenti il minimale', variabili),
      rigo('RR_TOTALE', 'Totale contributi dovuti', fissi + variabili),
    ],
  };
}

/** Quadro RX (compensazioni): in 6A nessun credito da anno precedente (→ 6C). */
export function buildQuadroRX(): Rigo[] {
  return [
    rigo('RX1', 'Credito da anno precedente', 0, 'zero'),
    rigo('RX4', 'Credito da riportare al periodo successivo', 0, 'zero'),
  ];
}

/** Quadro RS (dati informativi forfettari): vuoto in 6A (override informativi → 6C). */
export function buildQuadroRS(): Rigo[] {
  return [];
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/server/lib/dichiarazione-engine.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(server): motore dichiarazione — quadri RR/RX/RS"
```

---

## Task 3: Motore — frontespizio, warning, assemblaggio

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Append i test**

In `src/server/lib/dichiarazione-engine.test.ts` aggiungere:

```ts
import { buildFrontespizio, buildWarnings, buildDichiarazione } from './dichiarazione-engine';
import type { DichiarazioneInput, DichiarazioneYsView } from './dichiarazione-engine';

const ysBase: DichiarazioneYsView = {
  regime: 'forfettario', inpsMode: 'artigiani_commercianti',
  impostaSostitutiva: 0.15, coefficiente: 0.67, limiteForfettario: 85000,
};
function input(over: Partial<DichiarazioneInput> = {}): DichiarazioneInput {
  return {
    year: 2025, scenario: fakeScenario(), ys: ysBase,
    anagrafica: { cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-01', residenza: { citta: 'Roma', provincia: 'RM' } },
    dataInizioAttivita: '2022-01-01',
    ...over,
  };
}

test('buildFrontespizio: campi dal profilo, regime RF19', () => {
  const f = buildFrontespizio(input());
  assert.equal(f.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(f.cognome, 'Rossi');
  assert.equal(f.annoImposta, 2025);
  assert.equal(f.regime, 'RF19');
});

test('buildWarnings: frontespizio incompleto → error', () => {
  const w = buildWarnings(input({ anagrafica: { nome: 'Mario' } }));
  assert.ok(w.some((x) => x.code === 'FRONTESPIZIO_INCOMPLETO' && x.severity === 'error'));
});

test('buildWarnings: regime non forfettario → error', () => {
  const w = buildWarnings(input({ ys: { ...ysBase, regime: 'ordinario' } }));
  assert.ok(w.some((x) => x.code === 'REGIME_NON_FORFETTARIO' && x.severity === 'error'));
});

test('buildWarnings: reddito lordo oltre 85k → warn; oltre 100k → warn aggiuntivo', () => {
  const w85 = buildWarnings(input({ scenario: fakeScenario({ forfettarioGrossIncome: 90000 }) }));
  assert.ok(w85.some((x) => x.code === 'SOGLIA_85K'));
  const w100 = buildWarnings(input({ scenario: fakeScenario({ forfettarioGrossIncome: 101000 }) }));
  assert.ok(w100.some((x) => x.code === 'SOGLIA_100K'));
});

test('buildWarnings: startup 5% oltre 5 anni → warn', () => {
  const w = buildWarnings(input({ ys: { ...ysBase, impostaSostitutiva: 0.05 }, dataInizioAttivita: '2018-01-01' }));
  assert.ok(w.some((x) => x.code === 'STARTUP_5PCT_SCADUTO'));
});

test('buildWarnings: RS informativo sempre info', () => {
  assert.ok(buildWarnings(input()).some((x) => x.code === 'RS_INFORMATIVO' && x.severity === 'info'));
});

test('buildDichiarazione: assembla tutti i quadri', () => {
  const d = buildDichiarazione(input());
  assert.equal(d.quadroLM.length, 8);
  assert.equal(d.quadroRR.sezione, 'artigiani_commercianti');
  assert.equal(d.quadroRX.length, 2);
  assert.equal(d.frontespizio.regime, 'RF19');
  assert.ok(Array.isArray(d.warnings));
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/server/lib/dichiarazione-engine.test.ts`
Expected: FAIL — funzioni non esistono.

- [ ] **Step 3: Implementare** — append in `src/server/lib/dichiarazione-engine.ts`:

```ts
function yearOf(iso: string | undefined): number | null {
  if (!iso || !/^\d{4}/.test(iso)) return null;
  return Number(iso.slice(0, 4));
}

/** Frontespizio: contribuente dal profilo (anagrafica). Campi mancanti → '' (warning). */
export function buildFrontespizio(inp: DichiarazioneInput): Frontespizio {
  const a = inp.anagrafica;
  return {
    codiceFiscale: (a.cf ?? '').toUpperCase(),
    cognome: a.cognome ?? '',
    nome: a.nome ?? '',
    dataNascita: a.data_nascita ?? '',
    comune: a.residenza?.citta ?? '',
    provincia: (a.residenza?.provincia ?? '').toUpperCase(),
    annoImposta: inp.year,
    regime: 'RF19',
    tipoDichiarazione: 'ordinaria',
  };
}

/** Validazione fiscale → warning (error bloccanti per la compilazione, warn/info no). */
export function buildWarnings(inp: DichiarazioneInput): DichiarazioneWarning[] {
  const w: DichiarazioneWarning[] = [];
  const a = inp.anagrafica;

  if (inp.ys.regime !== 'forfettario') {
    w.push({ code: 'REGIME_NON_FORFETTARIO', severity: 'error', message: 'Il regime dell\'anno non è forfettario: questa dichiarazione copre solo RF19.' });
  }
  if (!a.cf || !(a.nome && a.cognome) || !a.data_nascita) {
    w.push({ code: 'FRONTESPIZIO_INCOMPLETO', severity: 'error', message: 'Anagrafica incompleta (codice fiscale, nome/cognome, data di nascita): completala nel Profilo personale.' });
  }
  const redditoLordo = inp.scenario.forfettarioGrossIncome;
  const limite = inp.ys.limiteForfettario || 85000;
  if (redditoLordo > limite + 15000) {
    w.push({ code: 'SOGLIA_100K', severity: 'warn', message: `Reddito lordo oltre ${limite + 15000} €: decadenza immediata dal forfettario nell'anno corrente (L. 197/2022).` });
  } else if (redditoLordo > limite) {
    w.push({ code: 'SOGLIA_85K', severity: 'warn', message: `Reddito lordo oltre ${limite} €: decadenza dal forfettario dall'anno successivo.` });
  }
  if (inp.ys.impostaSostitutiva === 0.05) {
    const annoInizio = yearOf(inp.dataInizioAttivita);
    if (annoInizio !== null && inp.year - annoInizio > 4) {
      w.push({ code: 'STARTUP_5PCT_SCADUTO', severity: 'warn', message: 'Aliquota startup 5% applicata ma sono trascorsi più di 5 anni dall\'apertura della P.IVA (art. 1 c. 65 L. 190/2014): verifica.' });
    }
  }
  w.push({ code: 'RS_INFORMATIVO', severity: 'info', message: 'Quadro RS: i dati sono solo informativi e NON deducono dal reddito forfettario.' });
  return w;
}

/** Assembla la dichiarazione completa dai dati dell'anno. */
export function buildDichiarazione(inp: DichiarazioneInput): Dichiarazione {
  return {
    frontespizio: buildFrontespizio(inp),
    quadroLM: buildQuadroLM(inp.scenario),
    quadroRR: buildQuadroRR(inp.scenario, inp.ys.inpsMode),
    quadroRX: buildQuadroRX(),
    quadroRS: buildQuadroRS(),
    warnings: buildWarnings(inp),
  };
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/server/lib/dichiarazione-engine.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(server): motore dichiarazione — frontespizio, warning, assemblaggio"
```

---

## Task 4: Route `GET /api/dichiarazione/:year`

**Files:**
- Create: `src/server/routes/dichiarazione.ts`
- Test: `src/server/routes/dichiarazione.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/server/routes/dichiarazione.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { dichiarazioneRoute } from './dichiarazione';
import { authRoute } from './auth';
import { yearSettingsRoute } from './year-settings';
import { profiles, yearSettings } from '../db/schema';
import { errorHandler } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

function makeApp(db: import('../db/client').Db) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.onError(errorHandler);
  app.route('/api/auth', authRoute);
  app.route('/api/dichiarazione', dichiarazioneRoute);
  return app;
}
async function login(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.it', password: 'pw-super-lunga-123' }),
  });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

test('GET /api/dichiarazione/:year → needsConfig se year-settings assente', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/dichiarazione/2025', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.needsConfig, true);
});

test('GET /api/dichiarazione/:year → dichiarazione con quadri quando configurato', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({
    anagrafica: JSON.stringify({ cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-01', residenza: { citta: 'Roma', provincia: 'RM' } }),
    attivita: JSON.stringify({ data_inizio_attivita: '2022-01-01' }),
  }).where(eq(profiles.id, p!.id));
  await db.insert(yearSettings).values({
    profileId: p!.id, year: 2025, regime: 'forfettario', coefficiente: 0.67,
    impostaSostitutiva: 0.15, inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    limiteForfettario: 85000, scadenziarioMetodo: 'storico',
  });

  const res = await app.request('/api/dichiarazione/2025', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.needsConfig, false);
  assert.equal(body.dichiarazione.frontespizio.codiceFiscale, 'RSSMRA80A01H501U');
  assert.ok(body.dichiarazione.quadroLM.length >= 8);
  assert.equal(body.dichiarazione.quadroRR.sezione, 'artigiani_commercianti');
});
```

> NB: l'insert del test fornisce tutte le colonne NOT NULL prive di default di `yearSettings` (`profileId, year, regime, coefficiente, impostaSostitutiva, inpsMode`) più alcune con default espliciti — verificato contro `src/server/db/schema.ts:54-78`. Sufficiente così.

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/server/routes/dichiarazione.test.ts`
Expected: FAIL — `./dichiarazione` non esiste.

- [ ] **Step 3: Implementare il route**

Create `src/server/routes/dichiarazione.ts`:

```ts
// src/server/routes/dichiarazione.ts
//
// GET /api/dichiarazione/:year — dichiarazione PF forfettaria (read-only, 6A).
// Orchestrazione I/O: carica lo scenario reale (come /api/tax/scenario) + profilo
// + year-settings, poi delega al motore puro `buildDichiarazione`. La verità
// fiscale è server-side; il client solo presenta.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { profiles, yearSettings } from '../db/schema';
import { requireSession, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { loadScenarioData } from '../lib/scenario-data';
import { buildForfettarioMethodComparison } from '../lib/tax-engine';
import {
  buildDichiarazione,
  type DichiarazioneAnagrafica,
  type DichiarazioneYsView,
} from '../lib/dichiarazione-engine';

export const dichiarazioneRoute = new Hono<AuthEnv>();
dichiarazioneRoute.use('*', requireSession);

function parseBlob(v: string | null): Record<string, unknown> {
  if (!v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch { return {}; }
}

function resolveYear(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno "${raw}" non valido.`);
  }
  return n;
}

dichiarazioneRoute.get('/:year', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = resolveYear(c.req.param('year'));

  // loadScenarioData ritorna null se le year-settings dell'anno mancano → needsConfig.
  const data = await loadScenarioData(db, profileId, year);
  if (!data) return c.json({ year, needsConfig: true });

  // Le year-settings esistono (loadScenarioData non-null): leggo la riga per la ys view.
  const [ysRow] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);
  if (!ysRow) return c.json({ year, needsConfig: true });

  const selected = buildForfettarioMethodComparison(data.comparisonInput).selected;

  const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!prof) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');
  const anagrafica = parseBlob(prof.anagrafica) as DichiarazioneAnagrafica;
  const attivita = parseBlob(prof.attivita) as { data_inizio_attivita?: string };

  const ys: DichiarazioneYsView = {
    regime: ysRow.regime,
    inpsMode: ysRow.inpsMode,
    impostaSostitutiva: Number(ysRow.impostaSostitutiva),
    coefficiente: Number(ysRow.coefficiente),
    limiteForfettario: Number(ysRow.limiteForfettario ?? 85000),
  };

  const dichiarazione = buildDichiarazione({
    year, scenario: selected, ys, anagrafica,
    dataInizioAttivita: attivita.data_inizio_attivita,
  });

  return c.json({ year, needsConfig: false, dichiarazione });
});
```

> NB: si legge `yearSettings` direttamente con Drizzle (verificato: `fetchYearSettings` NON è esportata da `scenario-data.ts`). Nessuna modifica a `scenario-data.ts`.

- [ ] **Step 4: Registrare il route** in `src/server/index.ts`

Cercare dove sono montati gli altri route (es. `app.route('/api/scadenziario', scadenziarioRoute)`) e aggiungere, con l'import in cima:
```ts
import { dichiarazioneRoute } from './routes/dichiarazione';
```
e nella registrazione:
```ts
app.route('/api/dichiarazione', dichiarazioneRoute);
```

- [ ] **Step 5: Verificare PASS** + typecheck

Run: `node --import tsx --test src/server/routes/dichiarazione.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/dichiarazione.ts src/server/routes/dichiarazione.test.ts src/server/index.ts
git commit -m "feat(server): GET /api/dichiarazione/:year (orchestrazione + motore)"
```

---

## Task 5: Pagina — render puri

**Files:**
- Create: `src/client/pages/dichiarazione.ts` (parte 1: render puri)
- Test: `src/client/pages/dichiarazione.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/pages/dichiarazione.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFrontespizio, renderQuadro, renderWarnings, renderConfigPrompt } from './dichiarazione';
import type { Dichiarazione } from '@server/lib/dichiarazione-engine';

const dich: Dichiarazione = {
  frontespizio: { codiceFiscale: 'RSSMRA80A01H501U', cognome: 'Rossi', nome: 'Mario', dataNascita: '1980-01-01', comune: 'Roma', provincia: 'RM', annoImposta: 2025, regime: 'RF19', tipoDichiarazione: 'ordinaria' },
  quadroLM: [{ key: 'LM1', label: 'Ricavi', value: 30000, source: 'computed' }, { key: 'LM45', label: 'Saldo', value: 1415, source: 'computed' }],
  quadroRR: { sezione: 'artigiani_commercianti', righi: [{ key: 'RR_TOTALE', label: 'Totale', value: 5200, source: 'computed' }] },
  quadroRX: [{ key: 'RX1', label: 'Credito', value: 0, source: 'zero' }],
  quadroRS: [],
  warnings: [{ code: 'RS_INFORMATIVO', severity: 'info', message: 'RS informativo' }],
};

test('renderFrontespizio: contribuente, anno, regime + nota anno imposta', () => {
  const html = renderFrontespizio(dich.frontespizio);
  assert.match(html, /RSSMRA80A01H501U/);
  assert.match(html, /Rossi/);
  assert.match(html, /2025/);
  assert.match(html, /RF19/);
  assert.match(html, /2026/); // nota: presentata nel 2026
});

test('renderQuadro: titolo + righi label/valore', () => {
  const html = renderQuadro('Quadro LM', dich.quadroLM);
  assert.match(html, /Quadro LM/);
  assert.match(html, /Ricavi/);
  assert.match(html, /€30\.000,00/);
});

test('renderQuadro: stato vuoto se nessun rigo', () => {
  assert.match(renderQuadro('Quadro RS', []), /Nessun dato/i);
});

test('renderWarnings: error rosso, info neutro; vuoto se nessuno', () => {
  const html = renderWarnings([
    { code: 'X', severity: 'error', message: 'Errore grave' },
    { code: 'RS_INFORMATIVO', severity: 'info', message: 'info' },
  ]);
  assert.match(html, /Errore grave/);
  assert.match(html, /dich-warn-error/);
  assert.equal(renderWarnings([]), '');
});

test('renderConfigPrompt: punta a /impostazioni', () => {
  assert.match(renderConfigPrompt(2025), /data-route="\/impostazioni"/);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/pages/dichiarazione.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare i render puri**

Create `src/client/pages/dichiarazione.ts`:

```ts
// src/client/pages/dichiarazione.ts
//
// Pagina "Dichiarazione" (/dichiarazione): vista READ-ONLY della dichiarazione PF
// forfettaria (frontespizio + quadri LM/RR/RX/RS + warning), da
// GET /api/dichiarazione/:year. La verità fiscale è server-side; qui si formatta.
// F24 (6B) e override (6C) arriveranno dopo. Pattern regime.ts: render puri + mount.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import type { Dichiarazione, Frontespizio, Rigo, DichiarazioneWarning } from '@server/lib/dichiarazione-engine';

interface DichiarazioneResponse {
  year: number;
  needsConfig: boolean;
  dichiarazione?: Dichiarazione;
}

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function sourceBadge(source: Rigo['source']): string {
  if (source === 'from-profile') return '<span class="dich-src">da profilo</span>';
  if (source === 'zero') return '<span class="dich-src">—</span>';
  return '';
}

export function renderFrontespizio(f: Frontespizio): string {
  const nome = [f.cognome, f.nome].filter(Boolean).join(' ') || '—';
  return `<div class="card dich-card dich-front">
    <div class="ys-crumb">Profilo ▸ Dichiarazione</div>
    <h2>Dichiarazione Redditi PF ${esc(f.annoImposta)}</h2>
    <div class="dich-front-grid">
      <div><span class="dich-k">Contribuente</span><span class="dich-v">${esc(nome)}</span></div>
      <div><span class="dich-k">Codice fiscale</span><span class="dich-v">${esc(f.codiceFiscale || '—')}</span></div>
      <div><span class="dich-k">Regime</span><span class="dich-v">${esc(f.regime)} (forfettario)</span></div>
      <div><span class="dich-k">Tipo</span><span class="dich-v">${esc(f.tipoDichiarazione)}</span></div>
    </div>
    <p class="dich-note">Anno d'imposta ${esc(f.annoImposta)} → dichiarazione da presentare nel ${esc(f.annoImposta + 1)}.</p>
  </div>`;
}

export function renderQuadro(titolo: string, righi: Rigo[]): string {
  if (!righi.length) {
    return `<div class="card dich-card"><h3>${esc(titolo)}</h3><p class="dich-note">Nessun dato in questa versione.</p></div>`;
  }
  const rows = righi.map((r) =>
    `<div class="dich-row"><span class="dich-row-k">${esc(r.key)} · ${esc(r.label)} ${sourceBadge(r.source)}</span>`
    + `<span class="dich-row-v">${esc(eur(r.value))}</span></div>`,
  ).join('');
  return `<div class="card dich-card"><h3>${esc(titolo)}</h3>${rows}</div>`;
}

export function renderWarnings(warnings: DichiarazioneWarning[]): string {
  if (!warnings.length) return '';
  const items = warnings.map((w) =>
    `<div class="dich-warn dich-warn-${esc(w.severity)}">${esc(w.message)}</div>`,
  ).join('');
  return `<div class="card dich-card dich-warns"><h3>Controlli</h3>${items}</div>`;
}

export function renderConfigPrompt(year: number): string {
  return `<div class="card dich-card">
    <h2>Dichiarazione ${esc(year)}</h2>
    <p class="dich-note">Anno non ancora configurato: imposta i parametri fiscali per generare la dichiarazione.</p>
    <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
  </div>`;
}

export function renderPage(d: Dichiarazione): string {
  const rrTitolo = d.quadroRR.sezione === 'gestione_separata'
    ? 'Quadro RR — Gestione separata' : 'Quadro RR — Artigiani/Commercianti';
  return `<div class="dich-page">
    ${renderFrontespizio(d.frontespizio)}
    ${renderWarnings(d.warnings)}
    ${renderQuadro('Quadro LM — Reddito forfettario', d.quadroLM)}
    ${renderQuadro(rrTitolo, d.quadroRR.righi)}
    ${renderQuadro('Quadro RX — Compensazioni', d.quadroRX)}
    ${renderQuadro('Quadro RS — Dati informativi', d.quadroRS)}
    <div class="card dich-card dich-cta">
      <div><h3>Modello F24</h3><p class="dich-note">Codici tributo e scadenze dei versamenti: in arrivo.</p></div>
      <button class="btn" type="button" disabled title="Disponibile prossimamente">Vai all'F24</button>
    </div>
  </div>`;
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/pages/dichiarazione.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS. (Import `api`/`ApiError`/`mountPage`/`getYear` non ancora usati: servono al Task 6.)

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/dichiarazione.ts src/client/pages/dichiarazione.test.ts
git commit -m "feat(client): render puri pagina Dichiarazione (read-only)"
```

---

## Task 6: Pagina — mount()

**Files:**
- Modify: `src/client/pages/dichiarazione.ts` (append `mount`)

- [ ] **Step 1: Append `mount`**

In coda a `src/client/pages/dichiarazione.ts`:

```ts
// ── mount ──

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/dichiarazione',
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card dich-card"><p class="dich-note">Carico la dichiarazione…</p></div>`;
      try {
        const data = await api.get<DichiarazioneResponse>(`/api/dichiarazione/${year}`);
        if (data.needsConfig || !data.dichiarazione) {
          main.innerHTML = renderConfigPrompt(data.year ?? year);
          return;
        }
        main.innerHTML = renderPage(data.dichiarazione);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare la dichiarazione. Riprova.';
        main.innerHTML = `<div class="card dich-card"><h2>Dichiarazione</h2><p class="dich-note dich-warn-error">${esc(msg)}</p></div>`;
      }
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Confermare i test render ancora verdi**

Run: `node --import tsx --test src/client/pages/dichiarazione.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/dichiarazione.ts
git commit -m "feat(client): mount Dichiarazione (fetch /api/dichiarazione/:year)"
```

---

## Task 7: Routing — collegare la pagina reale

**Files:**
- Modify: `src/client/main.ts`

- [ ] **Step 1: Sostituire il placeholder** nel mapping `routes`:
```ts
  '/dichiarazione': () => import('./pages/placeholder'),
```
con:
```ts
  '/dichiarazione': () => import('./pages/dichiarazione'),
```

- [ ] **Step 2: Typecheck + build web**

Run: `npm run typecheck`
Run: `npm run build:web`
Expected: PASS / build OK.

- [ ] **Step 3: Commit**

```bash
git add src/client/main.ts
git commit -m "feat(client): route /dichiarazione alla pagina reale"
```

---

## Task 8: Stili (`dich-*`)

**Files:**
- Modify: `src/client/styles/index.css`

- [ ] **Step 1: Appendere gli stili** in coda a `src/client/styles/index.css` (riusa `.card`, `.btn`, `.ys-crumb`):

```css
/* ── Dichiarazione ───────────────────────────────────────────────────── */
.dich-page { display: flex; flex-direction: column; gap: 16px; max-width: 760px; }
.dich-card { display: flex; flex-direction: column; gap: 8px; }
.dich-front-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 22px; margin-top: 8px; }
.dich-front-grid > div { display: flex; flex-direction: column; gap: 2px; }
.dich-k { font-size: .72rem; color: var(--text3); }
.dich-v { font-weight: 600; font-size: .9rem; }
.dich-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 5px 0; border-bottom: 1px solid var(--color-border); }
.dich-row:last-child { border-bottom: none; }
.dich-row-k { font-size: .82rem; color: var(--text2); }
.dich-row-v { font-weight: 600; font-size: .9rem; white-space: nowrap; }
.dich-src { font-size: .6rem; border: 1px solid var(--text3); border-radius: 999px; padding: 1px 6px; color: var(--text3); margin-left: 6px; }
.dich-note { font-size: .74rem; color: var(--text3); }
.dich-warns { gap: 6px; }
.dich-warn { font-size: .8rem; padding: 8px 12px; border-radius: 8px; border: 1px solid transparent; }
.dich-warn-error { color: var(--color-error); border-color: var(--color-error); background: rgba(220,80,80,.08); }
.dich-warn-warn { color: var(--color-warning); border-color: var(--color-warning); background: rgba(220,170,80,.08); }
.dich-warn-info { color: var(--text2); border-color: var(--color-border); }
.dich-cta { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
```

- [ ] **Step 2: Build web**

Run: `npm run build:web`
Expected: build OK senza errori CSS.

- [ ] **Step 3: Commit**

```bash
git add src/client/styles/index.css
git commit -m "style(client): stili pagina Dichiarazione (dich-*)"
```

---

## Task 9: Verifica finale

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: tutti i test verdi (inclusi: dichiarazione-engine, dichiarazione route, render pagina). NB: su Windows un raro fallimento flaky di `scadenziario-service.test.ts`/`fatture.test.ts` sotto run parallela è benigno (contesa DB temp libsql) — rieseguire in isolamento.

- [ ] **Step 2: Typecheck + build completa**

Run: `npm run typecheck`
Run: `npm run build`
Expected: PASS / build web+server OK.

- [ ] **Step 3: Smoke manuale (raccomandato)**

`npm run dev`, login → menu profilo → "Dichiarazione" apre `/dichiarazione` (anno dalla barra). Verifica: frontespizio col contribuente (dal Profilo personale) + nota anno imposta/presentazione; quadro LM coi righi (ricavi, reddito lordo, contributi, imponibile, imposta sostitutiva, acconti, saldo) coerenti con la pagina Regime/Tasse; quadro RR nel ramo giusto (gestione separata vs artigiani/commercianti); banner controlli (es. anagrafica incompleta → error con rimando al profilo; RS info). Su anno non configurato → prompt "Configura" → `/impostazioni`. CTA F24 disabilitata.

---

## Self-Review (compilata in stesura)

**Spec coverage:**
- Motore puro `dichiarazione-engine.ts` che mappa lo scenario → righi → Task 1-3. ✓
- Quadro LM (ricavi→reddito→contributi→imponibile→sostitutiva→saldo) → `buildQuadroLM` (Task 1). ✓
- Quadro RR gestione separata vs artigiani/commercianti (fissi+variabili) → `buildQuadroRR` (Task 2). ✓
- Quadri RX/RS (minimi in 6A) → `buildQuadroRX`/`buildQuadroRS` (Task 2). ✓
- Frontespizio da anagrafica + warning (regime, frontespizio, soglie 85k/100k, startup, RS info) → Task 3. ✓
- Endpoint `GET /api/dichiarazione/:year` (needsConfig, scoping attivo, riuso loadScenarioData) → Task 4. ✓
- Pagina read-only (frontespizio, card per quadro, warning, needsConfig, CTA F24 placeholder) → Task 5-6. ✓
- Routing + stili → Task 7-8. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice completo. Due NB di verifica (campi NOT NULL di `yearSettings` nel test; export di `fetchYearSettings`) sono istruzioni precise, non placeholder.

**Type consistency:** `Rigo`/`DichiarazioneWarning`/`Frontespizio`/`Dichiarazione`/`DichiarazioneInput`/`DichiarazioneYsView`/`DichiarazioneAnagrafica` definiti in Task 1/3 e usati in Task 4 (route) e Task 5 (client `import type` da `@server/lib/dichiarazione-engine`, come `regime.ts` importa `ForfettarioScenario`). `buildQuadroLM` ritorna 8 righi (test Task 3 lo verifica). `source` ∈ {'computed','from-profile','zero'} coerente fra engine e `sourceBadge`. Lo scenario è ottenuto via `buildForfettarioMethodComparison(...).selected` (come `tax.ts`).

**Note di rischio:**
- `fetchYearSettings` NON è esportata da `scenario-data.ts` (verificato): il route legge `yearSettings` direttamente con Drizzle. Nessuna modifica cross-modulo.
- Colonne NOT NULL di `yearSettings` senza default coperte dall'insert del test (verificato vs schema): `profileId, year, regime, coefficiente, impostaSostitutiva, inpsMode`.
- `AccontoPlan` nel `fakeScenario` di test è castato (`as never`) perché 6A non lo usa: accettabile in un fixture.
- La pagina importa i tipi via `import type { Dichiarazione } from '@server/lib/dichiarazione-engine'` (come `regime.ts` importa `ForfettarioScenario`): solo tipi, nessuna dipendenza runtime dal server nel bundle client.
