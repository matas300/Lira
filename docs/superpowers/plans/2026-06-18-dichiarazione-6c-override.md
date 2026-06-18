# Dichiarazione 6C — Rettifiche manuali Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere 3 rettifiche manuali (acconti versati LM43, crediti d'imposta LM39, credito anno precedente RX1) che ricalcolano il saldo dell'imposta sostitutiva, riflesse coerentemente in quadro LM, quadro RX e modello F24, persistite nel campo `overrides` JSON di `year_settings`.

**Architecture:** Una funzione pura `applyDichiarazioneOverrides(scenario, overrides)` calcola le grandezze effettive (acconti/crediti/credito-prec/saldo/credito-da-riportare) una sola volta a valle dello scenario; LM, RX e F24 consumano lo stesso oggetto `applied`. Con tutti gli override ai default i numeri sono identici a 6A/6B (invariante di non-regressione). Persistenza nel campo `overrides` JSON esistente sotto chiave `dichiarazione` (nessuna migration); nuovo `PATCH /api/dichiarazione/:year` con merge non-distruttivo che rispecchia il PATCH `/:year/warnings` di year-settings.

**Tech Stack:** TypeScript strict, Node `--test`, Hono + `@hono/zod-validator`, Vite vanilla DOM.

**Spec:** `docs/superpowers/specs/2026-06-18-dichiarazione-6c-override-design.md`

---

## File Structure

- `src/server/lib/dichiarazione-engine.ts` — `RigoSource` +'override', tipi override, `applyDichiarazioneOverrides`, firme `buildQuadroLM/buildQuadroRX/buildF24` con `applied`, wiring `buildDichiarazione`, warning.
- `src/server/lib/dichiarazione-engine.test.ts` — test override + adattamento test 6A/6B alle nuove firme.
- `src/server/routes/dichiarazione.ts` — helper `loadDichiarazioneResponse`, GET legge overrides, nuovo PATCH.
- `src/server/routes/dichiarazione.test.ts` — NUOVO: route test PATCH/GET (harness `createTestDb`).
- `src/client/pages/dichiarazione.ts` — `sourceBadge` +'override', blocco "Rettifiche manuali", wiring PATCH.
- `src/client/styles/index.css` — regole `.dich-adj-*`.

> Tasks 1–4 modificano tutte `dichiarazione-engine.ts`: l'intera suite torna verde solo a fine Task 4 (le firme cambiano in Task 2/3). Eseguirle in ordine.

---

## Task 1: `applyDichiarazioneOverrides` + tipi

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Aggiorna l'import in cima al file di test aggiungendo i nuovi simboli alla riga di import esistente:

```ts
import { applyDichiarazioneOverrides } from './dichiarazione-engine';
```

Aggiungi in fondo al file:

```ts
test('applyDichiarazioneOverrides: default → invariante 6A (saldoEffettivo === taxSaldo)', () => {
  const s = fakeScenario(); // substituteTax 2415, taxSaldo 1415
  const a = applyDichiarazioneOverrides(s, {});
  assert.equal(a.imposta, 2415);
  assert.equal(a.accontiVersati, 1000);     // 2415 − 1415 (acconti imputati)
  assert.equal(a.creditiImposta, 0);
  assert.equal(a.creditoAnnoPrec, 0);
  assert.equal(a.saldoEffettivo, 1415);     // === taxSaldo
  assert.equal(a.creditoDaRiportare, 0);
  assert.deepEqual(a.overridden, { accontiVersati: false, creditiImposta: false, creditoAnnoPrec: false });
});

test('applyDichiarazioneOverrides: override acconti cambia il saldo', () => {
  const a = applyDichiarazioneOverrides(fakeScenario(), { accontiVersati: 2000 });
  assert.equal(a.accontiVersati, 2000);
  assert.equal(a.overridden.accontiVersati, true);
  assert.equal(a.saldoEffettivo, 415);      // 2415 − 2000
  assert.equal(a.creditoDaRiportare, 0);
});

test('applyDichiarazioneOverrides: crediti + credito anno prec riducono il saldo, eccedenza → RX4', () => {
  const a = applyDichiarazioneOverrides(fakeScenario(), { creditiImposta: 500, creditoAnnoPrec: 2200 });
  // detrazioni = 500 + 1000(acc default) + 2200 = 3700 > 2415
  assert.equal(a.saldoEffettivo, 0);
  assert.equal(a.creditoDaRiportare, 1285); // 3700 − 2415
  assert.deepEqual(a.overridden, { accontiVersati: false, creditiImposta: true, creditoAnnoPrec: true });
});

test('applyDichiarazioneOverrides: valori non validi (neg/NaN/null) → default, non overridden', () => {
  const a = applyDichiarazioneOverrides(fakeScenario(), { accontiVersati: -5, creditiImposta: null });
  assert.equal(a.accontiVersati, 1000); // default
  assert.equal(a.overridden.accontiVersati, false);
  assert.equal(a.creditiImposta, 0);
  assert.equal(a.overridden.creditiImposta, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `applyDichiarazioneOverrides` non definita.

- [ ] **Step 3: Write minimal implementation**

In `dichiarazione-engine.ts`, estendi il tipo `RigoSource` (riga ~16):

```ts
export type RigoSource = 'computed' | 'from-profile' | 'zero' | 'override';
```

Aggiungi i tipi dopo `DichiarazioneInput` (dopo riga ~89):

```ts
export interface DichiarazioneOverridesInput {
  accontiVersati?: number | null;
  creditiImposta?: number | null;
  creditoAnnoPrec?: number | null;
}
export interface DichiarazioneOverridesApplied {
  imposta: number;
  accontiVersati: number;
  creditiImposta: number;
  creditoAnnoPrec: number;
  saldoEffettivo: number;
  creditoDaRiportare: number;
  overridden: { accontiVersati: boolean; creditiImposta: boolean; creditoAnnoPrec: boolean };
}
```

Aggiungi la funzione dopo `rigo(...)` (dopo riga ~99):

```ts
/** Override ammesso solo se numero finito ≥ 0; altrimenti si usa il default calcolato. */
function pickOverride(v: number | null | undefined, fallback: number): { value: number; overridden: boolean } {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { value: r2(v), overridden: true };
  return { value: r2(fallback), overridden: false };
}

/**
 * Applica le rettifiche manuali (6C) a valle dello scenario. Default = valori
 * calcolati di 6A → invariante di non-regressione. Imposta NON è override-abile.
 */
export function applyDichiarazioneOverrides(
  s: ForfettarioScenario, ov: DichiarazioneOverridesInput,
): DichiarazioneOverridesApplied {
  const imposta = r2(s.substituteTax);
  const accDefault = Math.max(0, r2(s.substituteTax - s.taxSaldo)); // acconti imputati (6A)
  const acc = pickOverride(ov.accontiVersati, accDefault);
  const cred = pickOverride(ov.creditiImposta, 0);
  const credPrev = pickOverride(ov.creditoAnnoPrec, 0);
  const detrazioni = r2(acc.value + cred.value + credPrev.value);
  return {
    imposta,
    accontiVersati: acc.value,
    creditiImposta: cred.value,
    creditoAnnoPrec: credPrev.value,
    saldoEffettivo: Math.max(0, r2(imposta - detrazioni)),
    creditoDaRiportare: Math.max(0, r2(detrazioni - imposta)),
    overridden: { accontiVersati: acc.overridden, creditiImposta: cred.overridden, creditoAnnoPrec: credPrev.overridden },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS sui 4 test `applyDichiarazioneOverrides:*`.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): applyDichiarazioneOverrides — saldo effettivo da rettifiche manuali"
```

---

## Task 2: `buildQuadroLM` + `buildQuadroRX` consumano `applied`

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts:102-115` (buildQuadroLM), `:141-146` (buildQuadroRX)
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Aggiungi un helper riutilizzabile vicino a `fakeScenario` nel file di test:

```ts
const appliedDefault = (over = {}) => applyDichiarazioneOverrides(fakeScenario(over), {});
```

Aggiorna i test 6A esistenti che chiamano `buildQuadroLM(fakeScenario())` / `buildQuadroRX()` per passare `applied` (cerca le occorrenze e cambiale in `buildQuadroLM(fakeScenario(), applyDichiarazioneOverrides(fakeScenario(), {}))` e `buildQuadroRX(applyDichiarazioneOverrides(fakeScenario(), {}))`). Gli assert su LM1..LM45/RX restano validi per l'invariante.

Aggiungi i nuovi test:

```ts
test('buildQuadroLM: include LM39 e usa saldoEffettivo per LM45', () => {
  const s = fakeScenario();
  const a = applyDichiarazioneOverrides(s, { creditiImposta: 200, accontiVersati: 800 });
  const righi = buildQuadroLM(s, a);
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('LM36').value, 2415);
  assert.equal(by('LM39').value, 200);
  assert.equal(by('LM39').source, 'override');
  assert.equal(by('LM43').value, 800);
  assert.equal(by('LM43').source, 'override');
  assert.equal(by('LM45').value, 1415); // 2415 − 200 − 800
});

test('buildQuadroLM: default → LM39 zero, LM43 computed (non override)', () => {
  const s = fakeScenario();
  const righi = buildQuadroLM(s, applyDichiarazioneOverrides(s, {}));
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('LM39').value, 0);
  assert.equal(by('LM39').source, 'zero');
  assert.equal(by('LM43').source, 'computed');
  assert.equal(by('LM45').value, 1415);
});

test('buildQuadroRX: RX1 da override, RX4 = credito da riportare', () => {
  const s = fakeScenario();
  const a = applyDichiarazioneOverrides(s, { creditoAnnoPrec: 2000 });
  const righi = buildQuadroRX(a);
  const by = (k: string) => righi.find((r) => r.key === k)!;
  assert.equal(by('RX1').value, 2000);
  assert.equal(by('RX1').source, 'override');
  // detrazioni = 1000(acc) + 2000 = 3000 > 2415 → RX4 = 585
  assert.equal(by('RX4').value, 585);
  assert.equal(by('RX4').source, 'computed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildQuadroLM`/`buildQuadroRX` con firma vecchia (troppi/pochi argomenti) o LM39 assente.

- [ ] **Step 3: Write minimal implementation**

Sostituisci `buildQuadroLM` (righe 101-115):

```ts
/** Quadro LM (forfettario): reddito + imposta + rettifiche 6C (LM39/LM43/LM45). */
export function buildQuadroLM(s: ForfettarioScenario, a: DichiarazioneOverridesApplied): Rigo[] {
  const lm4 = Math.max(0, s.forfettarioGrossIncome - s.deductibleContributionsPaid);
  return [
    rigo('LM1', 'Ricavi/compensi percepiti', s.grossCollected),
    rigo('LM2', 'Reddito forfettario lordo (ricavi × coefficiente)', s.forfettarioGrossIncome),
    rigo('LM3', 'Contributi previdenziali deducibili (cassa)', s.deductibleContributionsPaid),
    rigo('LM4', 'Reddito al netto dei contributi', lm4),
    rigo('LM34', 'Reddito imponibile', s.taxableBase),
    rigo('LM36', 'Imposta sostitutiva', a.imposta),
    rigo('LM39', 'Crediti d\'imposta', a.creditiImposta, a.overridden.creditiImposta ? 'override' : 'zero'),
    rigo('LM43', 'Acconti versati', a.accontiVersati, a.overridden.accontiVersati ? 'override' : 'computed'),
    rigo('LM45', 'Imposta sostitutiva a debito (saldo)', a.saldoEffettivo),
  ];
}
```

Sostituisci `buildQuadroRX` (righe 140-146):

```ts
/** Quadro RX (compensazioni): RX1 credito anno precedente (6C), RX4 credito da riportare. */
export function buildQuadroRX(a: DichiarazioneOverridesApplied): Rigo[] {
  return [
    rigo('RX1', 'Credito da anno precedente', a.creditoAnnoPrec, a.overridden.creditoAnnoPrec ? 'override' : 'zero'),
    rigo('RX4', 'Credito da riportare al periodo successivo', a.creditoDaRiportare, a.creditoDaRiportare > 0 ? 'computed' : 'zero'),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: i test LM/RX passano. (`buildDichiarazione`/`buildF24` ancora con firme vecchie → typecheck rosso, sistemato in Task 3/4.)

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): LM39 + LM/RX consumano applied (saldo effettivo, RX4)"
```

---

## Task 3: `buildF24` usa `saldoEffettivo`

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts:230-269`
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Aggiorna TUTTI i call site esistenti di `buildF24(s, ys, year)` nei test 6B aggiungendo il 4° argomento `applied`. Pattern: `buildF24(s, ys, 2025)` → `buildF24(s, ys, 2025, applyDichiarazioneOverrides(s, {}))`. Con `applied` di default i golden 6B restano identici (1792 = saldoEffettivo = taxSaldo).

Aggiungi un test override:

```ts
test('buildF24: il tributo 1792 usa saldoEffettivo (override azzera saldo → riga 1792 omessa)', () => {
  const s = fakeScenario(); // taxSaldo 1415
  const a = applyDichiarazioneOverrides(s, { accontiVersati: 2415 }); // saldoEffettivo = 0
  const mods = buildF24(s, { ...ys2025 }, 2025, a);
  const riga1792 = mods[0]!.righe.find((r) => r.codice === '1792');
  assert.equal(riga1792, undefined); // importo 0 → omessa
  // gli acconti su N+1 restano (base substituteTax 2415, non toccati)
  assert.ok(mods[0]!.righe.some((r) => r.codice === '1790'));
});

test('buildF24: 1792 riflette il saldoEffettivo ridotto da credito anno prec', () => {
  const s = fakeScenario();
  const a = applyDichiarazioneOverrides(s, { creditoAnnoPrec: 415 }); // saldo 1415 − 415 = 1000
  const mods = buildF24(s, { ...ys2025 }, 2025, a);
  assert.equal(mods[0]!.righe.find((r) => r.codice === '1792')!.importo, 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildF24` accetta 3 argomenti (il 4° non esiste ancora).

- [ ] **Step 3: Write minimal implementation**

Cambia la firma di `buildF24` (riga 230) e la riga del saldo (244):

```ts
export function buildF24(s: ForfettarioScenario, ys: DichiarazioneYsView, year: number, a: DichiarazioneOverridesApplied): F24Modulo[] {
```

e dentro `righeGiugno`, sostituisci la riga del saldo:

```ts
    f24Riga('erario', F24_ERARIO.saldo, 'Imposta sostitutiva — saldo', year, a.saldoEffettivo),
```

(Le altre righe — acconti, INPS — restano invariate: gli acconti su N+1 si basano su `substituteTax`, non sul saldo.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: i test F24 passano (golden 6B inclusi via `applied` di default). `buildDichiarazione` ancora rosso (Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): F24 tributo 1792 usa saldoEffettivo (coerenza con LM45)"
```

---

## Task 4: `buildDichiarazione` wiring + warning override

**Files:**
- Modify: `src/server/lib/dichiarazione-engine.ts:83-89` (DichiarazioneInput), `:288-299` (buildDichiarazione)
- Test: `src/server/lib/dichiarazione-engine.test.ts:81-87` (fixture `input`)

- [ ] **Step 1: Write the failing test**

Aggiungi `overrides` al fixture `input(...)` del test (default `{}`):

```ts
function input(over: Partial<DichiarazioneInput> = {}): DichiarazioneInput {
  return {
    year: 2025, scenario: fakeScenario(), ys: ysBase,
    anagrafica: { cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi', data_nascita: '1980-01-01', residenza: { citta: 'Roma', provincia: 'RM' } },
    dataInizioAttivita: '2022-01-01',
    overrides: {},
    ...over,
  };
}
```

Aggiungi:

```ts
test('buildDichiarazione: override attivo → LM45 ridotto e warning DICH_OVERRIDE_ATTIVO', () => {
  const d = buildDichiarazione(input({ overrides: { creditoAnnoPrec: 415 } }));
  const lm45 = d.quadroLM.find((r) => r.key === 'LM45')!;
  assert.equal(lm45.value, 1000); // 1415 − 415
  assert.ok(d.warnings.some((w) => w.code === 'DICH_OVERRIDE_ATTIVO' && w.severity === 'info'));
  // coerenza F24
  assert.equal(d.f24[0]!.righe.find((r) => r.codice === '1792')!.importo, 1000);
});

test('buildDichiarazione: nessun override → niente warning DICH_OVERRIDE_ATTIVO, numeri 6A', () => {
  const d = buildDichiarazione(input());
  assert.equal(d.quadroLM.find((r) => r.key === 'LM45')!.value, 1415);
  assert.ok(!d.warnings.some((w) => w.code === 'DICH_OVERRIDE_ATTIVO'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `DichiarazioneInput` non ha `overrides` / `buildDichiarazione` non applica nulla.

- [ ] **Step 3: Write minimal implementation**

Aggiungi `overrides` a `DichiarazioneInput` (dopo `dataInizioAttivita`):

```ts
export interface DichiarazioneInput {
  year: number;
  scenario: ForfettarioScenario;
  ys: DichiarazioneYsView;
  anagrafica: DichiarazioneAnagrafica;
  dataInizioAttivita?: string;
  overrides: DichiarazioneOverridesInput;
}
```

Sostituisci `buildDichiarazione`:

```ts
export function buildDichiarazione(inp: DichiarazioneInput): Dichiarazione {
  const applied = applyDichiarazioneOverrides(inp.scenario, inp.overrides);
  const f24 = buildF24(inp.scenario, inp.ys, inp.year, applied);
  const warnings: DichiarazioneWarning[] = [...buildWarnings(inp), ...buildF24Warnings(f24, inp.scenario, inp.ys)];
  const anyOverride = applied.overridden.accontiVersati || applied.overridden.creditiImposta || applied.overridden.creditoAnnoPrec;
  if (anyOverride) {
    warnings.push({ code: 'DICH_OVERRIDE_ATTIVO', severity: 'info', message: 'Rettifiche manuali attive: alcuni importi sono stati impostati manualmente e differiscono dal calcolo automatico.' });
  }
  return {
    frontespizio: buildFrontespizio(inp),
    quadroLM: buildQuadroLM(inp.scenario, applied),
    quadroRR: buildQuadroRR(inp.scenario, inp.ys.inpsMode),
    quadroRX: buildQuadroRX(applied),
    quadroRS: buildQuadroRS(),
    f24,
    warnings,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: TUTTI verdi (6A + 6B + 6C). Inoltre `npx tsc -p tsconfig.server.json --noEmit` → nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/dichiarazione-engine.ts src/server/lib/dichiarazione-engine.test.ts
git commit -m "feat(dichiarazione): buildDichiarazione applica overrides + warning DICH_OVERRIDE_ATTIVO"
```

---

## Task 5: Route — GET legge overrides + PATCH dedicato

**Files:**
- Modify: `src/server/routes/dichiarazione.ts`
- Test: `src/server/routes/dichiarazione.test.ts` (NUOVO)

- [ ] **Step 1: Write the failing test**

Crea `src/server/routes/dichiarazione.test.ts`:

```ts
// src/server/routes/dichiarazione.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { createSession } from '../lib/session';
import { errorHandler } from '../middleware/error';
import { type AuthEnv } from '../middleware/auth';
import { dichiarazioneRoute } from './dichiarazione';
import { yearSettingsRoute } from './year-settings';

async function makeApp() {
  const { db } = await createTestDb();
  const { userId, profileId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  const session = await createSession(db, userId, profileId);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); }); // requireSession (nel route) popola userId/activeProfileId dal cookie
  app.onError(errorHandler);
  app.route('/api/dichiarazione', dichiarazioneRoute);
  app.route('/api/year-settings', yearSettingsRoute);
  const headers = { cookie: `lira_session=${session.id}`, 'content-type': 'application/json' };
  // crea year-settings 2025 forfettario
  await app.request('/api/year-settings/2025', { method: 'PUT', headers, body: JSON.stringify({
    regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  }) });
  return { app, headers };
}

test('PATCH /api/dichiarazione/:year salva override e li riflette nel GET', async () => {
  const { app, headers } = await makeApp();
  const patch = await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 100 }) });
  assert.equal(patch.status, 200);
  const get = await app.request('/api/dichiarazione/2025', { headers });
  const body = await get.json();
  const rx1 = body.dichiarazione.quadroRX.find((r) => r.key === 'RX1');
  assert.equal(rx1.value, 100);
  assert.equal(rx1.source, 'override');
});

test('PATCH con null rimuove l\'override (torna al default)', async () => {
  const { app, headers } = await makeApp();
  await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 100 }) });
  await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: null }) });
  const get = await app.request('/api/dichiarazione/2025', { headers });
  const body = await get.json();
  assert.equal(body.dichiarazione.quadroRX.find((r) => r.key === 'RX1').value, 0);
  assert.equal(body.dichiarazione.quadroRX.find((r) => r.key === 'RX1').source, 'zero');
});

test('PATCH su anno non configurato → 404', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/dichiarazione/2030', { method: 'PATCH', headers, body: JSON.stringify({ creditoAnnoPrec: 1 }) });
  assert.equal(res.status, 404);
});

test('PATCH con valore negativo → 422', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/dichiarazione/2025', { method: 'PATCH', headers, body: JSON.stringify({ creditiImposta: -5 }) });
  assert.equal(res.status, 400); // zValidator → 400
});
```

> Note: (1) `zValidator` risponde 400 sugli errori di schema (non 422) — l'ultimo test asserisce 400. (2) `requireSession` (montato nel route con `.use('*', requireSession)`) legge il cookie e popola `userId`/`activeProfileId`: il middleware di test deve settare solo `db`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — manca il PATCH / il GET non legge gli override.

- [ ] **Step 3: Write minimal implementation**

Riscrivi `src/server/routes/dichiarazione.ts` per: (a) estrarre un helper che carica e costruisce la risposta, (b) far leggere al GET gli override `dichiarazione`, (c) aggiungere il PATCH. Aggiungi gli import in cima:

```ts
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
```

e i tipi dal motore:

```ts
import {
  buildDichiarazione,
  type DichiarazioneAnagrafica,
  type DichiarazioneYsView,
  type DichiarazioneOverridesInput,
} from '../lib/dichiarazione-engine';
```

Aggiungi un helper di parse difensivo + builder della risposta (sotto `parseBlob`):

```ts
function readDichiarazioneOverrides(raw: string | null): DichiarazioneOverridesInput {
  const o = parseBlob(raw);
  const d = (o.dichiarazione && typeof o.dichiarazione === 'object' && !Array.isArray(o.dichiarazione))
    ? (o.dichiarazione as Record<string, unknown>) : {};
  const num = (v: unknown): number | null | undefined =>
    typeof v === 'number' ? v : v === null ? null : undefined;
  return { accontiVersati: num(d.accontiVersati), creditiImposta: num(d.creditiImposta), creditoAnnoPrec: num(d.creditoAnnoPrec) };
}

async function loadDichiarazioneResponse(db: Db, profileId: string, year: number) {
  const data = await loadScenarioData(db, profileId, year);
  if (!data) return { year, needsConfig: true as const };

  const [ysRow] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year))).limit(1);
  if (!ysRow) return { year, needsConfig: true as const };

  const scenario = buildForfettarioMethodComparison(data.comparisonInput).historical;

  const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!prof) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');
  const anagrafica = parseBlob(prof.anagrafica) as DichiarazioneAnagrafica;
  const attivita = parseBlob(prof.attivita) as { data_inizio_attivita?: string };

  const ys: DichiarazioneYsView = {
    regime: ysRow.regime,
    inpsMode: ysRow.inpsMode,
    inpsCategoria: ysRow.inpsCategoria ?? null,
    impostaSostitutiva: Number(ysRow.impostaSostitutiva),
    coefficiente: Number(ysRow.coefficiente),
    limiteForfettario: Number(ysRow.limiteForfettario ?? 85000),
    prorogaSaldoAt: ysRow.prorogaSaldoAt ?? null,
  };

  const dichiarazione = buildDichiarazione({
    year, scenario, ys, anagrafica,
    dataInizioAttivita: attivita.data_inizio_attivita,
    overrides: readDichiarazioneOverrides(ysRow.overrides),
  });
  return { year, needsConfig: false as const, dichiarazione };
}
```

Aggiungi l'import del tipo `Db`:

```ts
import type { Db } from '../db/client';
```

Sostituisci l'handler GET col solo wiring all'helper:

```ts
dichiarazioneRoute.get('/:year', async (c) => {
  const year = parseYearParam(c.req.param('year'));
  return c.json(await loadDichiarazioneResponse(c.get('db'), c.get('activeProfileId'), year));
});
```

Aggiungi il PATCH (rispecchia `PATCH /:year/warnings` di year-settings):

```ts
const OverridesPatchInput = z.object({
  accontiVersati: z.number().nonnegative().nullable().optional(),
  creditiImposta: z.number().nonnegative().nullable().optional(),
  creditoAnnoPrec: z.number().nonnegative().nullable().optional(),
});

dichiarazioneRoute.patch('/:year', zValidator('json', OverridesPatchInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = parseYearParam(c.req.param('year'));
  const patch = c.req.valid('json');

  const [row] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year))).limit(1);
  if (!row) throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND', `Impostazioni anno ${year} non trovate`);

  // parse difensivo dell'overrides JSON esistente (preserva gli override scadenziario)
  let overrides: Record<string, unknown> = {};
  if (row.overrides) {
    try {
      const parsed = JSON.parse(row.overrides) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed as Record<string, unknown>;
    } catch { overrides = {}; }
  }
  const dich: Record<string, unknown> = (overrides.dichiarazione && typeof overrides.dichiarazione === 'object' && !Array.isArray(overrides.dichiarazione))
    ? (overrides.dichiarazione as Record<string, unknown>) : {};

  for (const k of ['accontiVersati', 'creditiImposta', 'creditoAnnoPrec'] as const) {
    if (!(k in patch)) continue;          // non fornito → invariato
    const v = patch[k];
    if (v === null) delete dich[k];        // null → torna al default
    else dich[k] = v;
  }
  overrides.dichiarazione = dich;

  await db.update(yearSettings).set({ overrides: JSON.stringify(overrides) })
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));

  return c.json(await loadDichiarazioneResponse(db, profileId, year));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: i 4 test route passano. Typecheck: `npx tsc -p tsconfig.server.json --noEmit` → ok.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/dichiarazione.ts src/server/routes/dichiarazione.test.ts
git commit -m "feat(dichiarazione): GET legge overrides + PATCH /:year rettifiche (merge non-distruttivo)"
```

---

## Task 6: Frontend — blocco "Rettifiche manuali"

**Files:**
- Modify: `src/client/pages/dichiarazione.ts`
- Modify: `src/client/styles/index.css` (dopo le regole `.dich-f24-*`)

- [ ] **Step 1: Implementa (no DOM unit test in repo — verifica typecheck/build)**

In `src/client/pages/dichiarazione.ts`:

Estendi `sourceBadge` (riga ~22) per gestire `override`:

```ts
function sourceBadge(source: Rigo['source']): string {
  if (source === 'from-profile') return '<span class="dich-src">da profilo</span>';
  if (source === 'override') return '<span class="dich-src dich-src-ovr">rettifica</span>';
  if (source === 'zero') return '<span class="dich-src">—</span>';
  return '';
}
```

Aggiungi un import `api` già presente; aggiungi il render del blocco rettifiche (dopo `renderF24`). Il blocco legge i valori effettivi correnti dai quadri per pre-popolare gli input:

```ts
function lmVal(d: Dichiarazione, key: string): number {
  return d.quadroLM.find((r) => r.key === key)?.value
    ?? d.quadroRX.find((r) => r.key === key)?.value ?? 0;
}

export function renderRettifiche(d: Dichiarazione): string {
  const acc = lmVal(d, 'LM43');
  const cred = lmVal(d, 'LM39');
  const rx1 = lmVal(d, 'RX1');
  return `<div class="card dich-card dich-adj">
    <h3>Rettifiche manuali</h3>
    <p class="dich-note">Imposta i valori solo se differiscono dal calcolo automatico. Lascia vuoto/azzera per usare il valore calcolato.</p>
    <div class="dich-adj-grid">
      <label>Acconti versati (LM43)<input type="number" step="0.01" min="0" id="adj-acconti" value="${esc(acc)}"></label>
      <label>Crediti d'imposta (LM39)<input type="number" step="0.01" min="0" id="adj-crediti" value="${esc(cred)}"></label>
      <label>Credito anno precedente (RX1)<input type="number" step="0.01" min="0" id="adj-credprec" value="${esc(rx1)}"></label>
    </div>
    <div class="dich-adj-actions">
      <button class="btn btn-primary" type="button" id="adj-save">Salva rettifiche</button>
      <button class="btn" type="button" id="adj-reset">Ripristina calcolato</button>
      <span class="dich-note" id="adj-msg"></span>
    </div>
  </div>`;
}
```

In `renderPage`, aggiungi `${renderRettifiche(d)}` dopo `${renderF24(d.f24)}`.

Nel `mount`, dopo aver fatto `main.innerHTML = renderPage(...)`, aggancia gli handler. Estrai il render+bind in una funzione locale `paint(d)` riutilizzabile dopo il PATCH:

```ts
const year = getYear();
const paint = (d: Dichiarazione): void => {
  main.innerHTML = renderPage(d);
  const num = (id: string): number | null => {
    const el = main.querySelector<HTMLInputElement>(id);
    const v = el && el.value.trim() !== '' ? Number(el.value) : null;
    return v != null && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const msg = main.querySelector<HTMLElement>('#adj-msg');
  const save = main.querySelector<HTMLButtonElement>('#adj-save');
  const reset = main.querySelector<HTMLButtonElement>('#adj-reset');
  const patch = async (bodyObj: Record<string, number | null>): Promise<void> => {
    if (msg) msg.textContent = 'Salvataggio…';
    try {
      const resp = await api.patch<DichiarazioneResponse>(`/api/dichiarazione/${year}`, bodyObj);
      if (resp.dichiarazione) paint(resp.dichiarazione);
    } catch (err) {
      if (msg) msg.textContent = err instanceof ApiError ? err.message : 'Errore nel salvataggio.';
    }
  };
  save?.addEventListener('click', () => void patch({ accontiVersati: num('#adj-acconti'), creditiImposta: num('#adj-crediti'), creditoAnnoPrec: num('#adj-credprec') }));
  reset?.addEventListener('click', () => void patch({ accontiVersati: null, creditiImposta: null, creditoAnnoPrec: null }));
};
```

e nel blocco `try` del render sostituisci `main.innerHTML = renderPage(data.dichiarazione);` con `paint(data.dichiarazione);`.

> `api.patch<T>(path, body)` è già presente in `src/client/lib/api.ts` (riga 52) — usalo direttamente, nessuna aggiunta.

- [ ] **Step 2: CSS**

In `src/client/styles/index.css`, dopo le regole `.dich-f24-*`:

```css
.dich-adj-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 8px 0; }
.dich-adj-grid label { display: flex; flex-direction: column; gap: 4px; font-size: .78rem; color: var(--text2); }
.dich-adj-grid input { padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--bg2, transparent); color: var(--text); }
.dich-adj-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dich-src-ovr { border-color: var(--accent, #4caf50); color: var(--accent, #4caf50); }
```

- [ ] **Step 3: Verify**

Run: `npx tsc -p tsconfig.json --noEmit` e `npm run build` e `npm test`
Expected: nessun errore di tipo, build ok, test verdi.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/dichiarazione.ts src/client/styles/index.css
git commit -m "feat(client): blocco Rettifiche manuali + badge override nella Dichiarazione"
```

---

## Task 7: Verifica finale

**Files:**
- Test: `src/server/lib/dichiarazione-engine.test.ts`

- [ ] **Step 1: Golden coerenza LM/RX/F24 con override**

Aggiungi un test che blocca la coerenza end-to-end del motore:

```ts
test('GOLDEN 6C: override completo coerente su LM/RX/F24', () => {
  const s = fakeScenario(); // imposta 2415, taxSaldo 1415
  const d = buildDichiarazione(input({ overrides: { accontiVersati: 900, creditiImposta: 100, creditoAnnoPrec: 200 } }));
  // saldo = 2415 − 900 − 100 − 200 = 1215
  assert.equal(d.quadroLM.find((r) => r.key === 'LM45')!.value, 1215);
  assert.equal(d.quadroLM.find((r) => r.key === 'LM39')!.value, 100);
  assert.equal(d.quadroLM.find((r) => r.key === 'LM43')!.value, 900);
  assert.equal(d.quadroRX.find((r) => r.key === 'RX1')!.value, 200);
  assert.equal(d.quadroRX.find((r) => r.key === 'RX4')!.value, 0);
  assert.equal(d.f24[0]!.righe.find((r) => r.codice === '1792')!.importo, 1215);
});
```

- [ ] **Step 2: Run full suite + typecheck**

Run: `npm test`
Expected: tutti verdi (nota: `session.test.ts`/`scadenziario-service.test.ts` possono essere flaky in parallelo su Windows — verde in isolamento).

Run: `npx tsc -p tsconfig.server.json --noEmit && npx tsc -p tsconfig.json --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add src/server/lib/dichiarazione-engine.test.ts
git commit -m "test(dichiarazione): golden 6C coerenza LM/RX/F24 con override"
```

---

## Self-review note (autore del piano)

- **Copertura spec:** 3 knob + formula (Task 1), LM39/LM45/RX (Task 2), F24 1792=saldoEffettivo (Task 3), wiring+warning (Task 4), persistenza overrides JSON + PATCH merge non-distruttivo + GET (Task 5), frontend rettifiche + badge (Task 6), golden coerenza (Task 7). ✔
- **Invariante non-regressione:** default `applied` mantiene i golden 6A/6B; i call site dei test 6A/6B sono aggiornati a passare `applied` di default (Task 2/3). ✔
- **Naming coerente:** `applyDichiarazioneOverrides`, `DichiarazioneOverridesInput/Applied`, campi `accontiVersati/creditiImposta/creditoAnnoPrec/saldoEffettivo/creditoDaRiportare/overridden`, source `'override'`, warning `DICH_OVERRIDE_ATTIVO`, chiave JSON `overrides.dichiarazione` — identici in tutti i task. ✔
- **No migration:** riuso campo `overrides` JSON (Task 5 lo legge/scrive con merge difensivo, preservando gli override scadenziario). ✔
- **Dipendenza Task 1→4:** firme `buildQuadroLM/RX/F24` cambiano in Task 2/3 → suite verde solo da fine Task 4. Annotato.
- **Rischio `api.patch`:** Task 6 Step 1 verifica/aggiunge `api.patch` se assente. ✔
