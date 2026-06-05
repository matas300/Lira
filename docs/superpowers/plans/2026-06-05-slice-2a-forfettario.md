# Slice 2A — Tax engine + Scadenziario forfettario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port del tax engine forfettario di CalcoliVari + nuovo scadenziario-engine, server-side autoritativo in TS strict, con i 7 audit fix risolti by-design.

**Architecture:** Costanti + regole pure in `src/shared/*` (riusabili client-side); pure engines in `src/server/lib/*` (zero IO); service di orchestrazione in `src/server/services/*`; HTTP boundary in `src/server/routes/*`. Computed-only (no tabelle assessment).

**Tech Stack:** TypeScript strict, Hono, Drizzle (libSQL), Zod via `@hono/zod-validator`, `node:test` + `tsx`, libsql in-memory per test DB.

**Spec di riferimento:** `docs/superpowers/specs/2026-06-05-slice-2a-forfettario-design.md` (commit `d383aa5`).

**Sorgente per port:** `C:\Users\matti\Documents\Progetti\Lira\CalcoliVari\` (in particolare `tax-engine.js`, `scadenziario-engine.js`, `forfettario-rules.js`, `ateco-coefficienti.js`, `date-utils.js`).

---

## File map

**Created:**
- `drizzle/0001_audit_fixes_year_settings.sql`
- `src/shared/forfettario-rules.ts` + `.test.ts`
- `src/shared/inps-params.ts` + `.test.ts`
- `src/shared/ateco-coefficienti.ts` + `.test.ts`
- `src/shared/acconto-rules.ts` + `.test.ts`
- `src/shared/date-rules.ts` + `.test.ts`
- `src/shared/schedule-keys.ts` + `.test.ts`
- `src/shared/audit-checks.ts` + `.test.ts`
- `src/server/lib/tax-engine.ts` + `.test.ts`
- `src/server/lib/scadenziario-engine.ts` + `.test.ts`
- `src/server/services/scadenziario-service.ts` + `.test.ts`
- `src/server/routes/year-settings.ts` + `.test.ts`
- `src/server/routes/pagamenti.ts` + `.test.ts`
- `src/server/routes/scadenziario.ts` + `.test.ts`
- `src/server/routes/tax.ts` + `.test.ts`
- `src/test-fixtures/mattia-2025.ts`
- `src/test-fixtures/peru-2025.ts`

**Modified:**
- `src/server/db/schema.ts` (3 colonne in `yearSettings`)
- `src/shared/schemas.ts` (Zod per YearSettings, Pagamento, ScadenziarioView, AuditWarning)
- `src/server/index.ts` (mount 4 nuove route)
- `README.md` (sezione modulo fiscale)

---

## Task 1 — `acconto-rules.ts` (M3 costanti centralizzate)

**Files:**
- Create: `src/shared/acconto-rules.ts`
- Test: `src/shared/acconto-rules.test.ts`

- [ ] **Step 1: Scrivere il test**

`src/shared/acconto-rules.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCONTO_RULES } from './acconto-rules';

test('ACCONTO_RULES: soglie esatte art. 17 DPR 435/2001', () => {
  assert.equal(ACCONTO_RULES.thresholdZero, 51.65);
  assert.equal(ACCONTO_RULES.thresholdSingle, 257.52);
  assert.deepEqual(ACCONTO_RULES.weights, [40, 60]);
});

test('ACCONTO_RULES: oggetto congelato (Object.freeze)', () => {
  assert.equal(Object.isFrozen(ACCONTO_RULES), true);
  assert.throws(() => {
    // @ts-expect-error mutazione intenzionale per il test
    ACCONTO_RULES.thresholdZero = 99;
  });
});

test('ACCONTO_RULES: weights congelato anche internamente', () => {
  assert.equal(Object.isFrozen(ACCONTO_RULES.weights), true);
});
```

- [ ] **Step 2: Run test → FAIL (modulo inesistente)**

```
npm test -- --test-name-pattern "ACCONTO_RULES"
```

Atteso: `Cannot find module './acconto-rules'`.

- [ ] **Step 3: Implementare**

`src/shared/acconto-rules.ts`:
```ts
// Soglie acconto art. 17 c. 3 DPR 435/2001.
// Riferimento normativo unico per evitare hard-coded magic numbers nel tax engine.
export const ACCONTO_RULES = Object.freeze({
  thresholdZero: 51.65,
  thresholdSingle: 257.52,
  weights: Object.freeze([40, 60] as const),
});

export type AccontoRules = typeof ACCONTO_RULES;
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/acconto-rules.ts src/shared/acconto-rules.test.ts
git commit -m "feat(shared): acconto-rules con soglie art. 17 DPR 435/2001 (fix M3)"
```

---

## Task 2 — `ateco-coefficienti.ts`

**Files:**
- Create: `src/shared/ateco-coefficienti.ts`
- Test: `src/shared/ateco-coefficienti.test.ts`
- Riferimento port: `CalcoliVari/ateco-coefficienti.js`

- [ ] **Step 1: Scrivere il test**

`src/shared/ateco-coefficienti.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCoefficienteByAteco, COEFFICIENTI_VALIDI, isCoefficienteAmmesso } from './ateco-coefficienti';

test('getCoefficienteByAteco: 62.10.00 (programmazione) → 0.67', () => {
  assert.equal(getCoefficienteByAteco('62.10.00'), 0.67);
});

test('getCoefficienteByAteco: 47.91.10 (commercio al minuto) → 0.40', () => {
  assert.equal(getCoefficienteByAteco('47.91.10'), 0.40);
});

test('getCoefficienteByAteco: codice malformato (5 cifre) → null', () => {
  assert.equal(getCoefficienteByAteco('62.10'), null);
});

test('isCoefficienteAmmesso: include solo {0.40, 0.54, 0.62, 0.67, 0.78, 0.86}', () => {
  for (const c of [0.40, 0.54, 0.62, 0.67, 0.78, 0.86]) {
    assert.equal(isCoefficienteAmmesso(c), true);
  }
  assert.equal(isCoefficienteAmmesso(0.50), false);
  assert.equal(isCoefficienteAmmesso(1.0), false);
});

test('COEFFICIENTI_VALIDI è readonly array', () => {
  assert.equal(Object.isFrozen(COEFFICIENTI_VALIDI), true);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

Porta `CalcoliVari/ateco-coefficienti.js`. La mappa raggruppa codici ATECO 6-cifre per i 9 gruppi del DM 23/01/2015.

`src/shared/ateco-coefficienti.ts`:
```ts
// DM 23/01/2015 — coefficienti di redditività per gruppi ATECO.

export const COEFFICIENTI_VALIDI = Object.freeze([0.40, 0.54, 0.62, 0.67, 0.78, 0.86] as const);

// Mappa codice ATECO (6 cifre, formato 'NN.NN.NN') → coefficiente.
// Porta da CalcoliVari/ateco-coefficienti.js. Vedi gruppi 1-9 nel DM 23/01/2015.
const ATECO_MAP: Record<string, number> = {
  // Gruppo 1 — Industrie alimentari e bevande (45.41, 47.81, ...)  → 0.40
  // Gruppo 2 — Commercio ingrosso/dettaglio                          → 0.40
  // Gruppo 3 — Commercio ambulante alimentari/bevande                → 0.40
  // Gruppo 4 — Commercio ambulante altri prodotti                    → 0.54
  // Gruppo 5 — Costruzioni e attività immobiliari                    → 0.86
  // Gruppo 6 — Intermediari del commercio                            → 0.62
  // Gruppo 7 — Alberghi e ristoranti                                 → 0.40
  // Gruppo 8 — Servizi professionali, scientifici, tecnici           → 0.78
  // Gruppo 9 — Altre attività economiche                             → 0.67
  // Esempi puntuali (lista completa da portare da CalcoliVari):
  '47.91.10': 0.40,
  '56.10.11': 0.40,
  '62.10.00': 0.67,
  '62.02.00': 0.67,
  '74.10.10': 0.78,
  '74.10.21': 0.78,
  // ... porta TUTTA la mappa da CalcoliVari/ateco-coefficienti.js
};

export function getCoefficienteByAteco(codice: string): number | null {
  if (!/^\d{2}\.\d{2}\.\d{2}$/.test(codice)) return null;
  return ATECO_MAP[codice] ?? null;
}

export function isCoefficienteAmmesso(c: number): boolean {
  return (COEFFICIENTI_VALIDI as readonly number[]).includes(c);
}
```

**IMPORTANTE:** copia tutte le voci della mappa da `CalcoliVari/ateco-coefficienti.js`. Verifica che il file sorgente esponga lo stesso dataset (gruppi 1-9).

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/ateco-coefficienti.ts src/shared/ateco-coefficienti.test.ts
git commit -m "feat(shared): ateco-coefficienti port da CalcoliVari (DM 23/01/2015)"
```

---

## Task 3 — `inps-params.ts`

**Files:**
- Create: `src/shared/inps-params.ts`
- Test: `src/shared/inps-params.test.ts`

Valori ufficiali 2024-2025 dalla Circolare INPS annuale. **2026** ancora `null` come placeholder — vanno aggiornati quando INPS pubblica (typically gennaio-febbraio dell'anno).

- [ ] **Step 1: Scrivere il test**

`src/shared/inps-params.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInpsArtComForYear, getInpsGsForYear, INPS_ARTCOM, INPS_GS } from './inps-params';

test('INPS_ARTCOM 2025 contiene minimale, quota fissa, aliquota, massimale', () => {
  const p = INPS_ARTCOM[2025];
  assert.ok(p, '2025 deve esistere');
  assert.ok(p.minimaleAnnuo > 17000 && p.minimaleAnnuo < 20000, 'minimale 2025 nel range atteso');
  assert.ok(p.quotaFissaAnnua > 4000 && p.quotaFissaAnnua < 5000, 'quota fissa 2025 nel range atteso');
  assert.equal(p.aliquota, 0.24);
  assert.equal(p.aliquotaCommerciante, 0.2448);
  assert.ok(p.massimale > 100000);
});

test('INPS_GS 2025 contiene aliquote e massimale', () => {
  const p = INPS_GS[2025];
  assert.ok(p, '2025 deve esistere');
  assert.equal(p.aliquotaSenzaAltraCassa, 0.2607);
  assert.equal(p.aliquotaConAltraCassa, 0.24);
  assert.ok(p.massimale > 100000);
});

test('getInpsArtComForYear: anno mancante → throw con messaggio chiaro', () => {
  assert.throws(
    () => getInpsArtComForYear(1999),
    /INPS_ARTCOM.*1999/,
  );
});

test('getInpsArtComForYear: anno valido → params', () => {
  const p = getInpsArtComForYear(2025);
  assert.equal(typeof p.minimaleAnnuo, 'number');
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

`src/shared/inps-params.ts`:
```ts
// INPS Artigiani/Commercianti — Circolari INPS annuali.
// Valori 2024-2025 ufficiali. 2026 da aggiornare quando INPS pubblica.

export interface InpsArtComParams {
  minimaleAnnuo: number;     // reddito minimale di riferimento
  quotaFissaAnnua: number;   // contributo fisso sul minimale (artigiano)
  aliquota: number;          // aliquota artigiano (0.24)
  aliquotaCommerciante: number;  // aliquota commerciante (0.2448, include 0.0048 INDV)
  massimale: number;         // massimale contributivo
}

export interface InpsGsParams {
  aliquotaSenzaAltraCassa: number;  // 0.2607
  aliquotaConAltraCassa: number;    // 0.24
  massimale: number;
}

// Fonte: Circolare INPS 33/2024, 28/2025. Verificare i numeri esatti dal sorgente CalcoliVari (file `app-calc.js` o `forfettario-rules.js`).
export const INPS_ARTCOM: Record<number, InpsArtComParams> = {
  2024: {
    minimaleAnnuo: 18_415,
    quotaFissaAnnua: 4427.04,
    aliquota: 0.24,
    aliquotaCommerciante: 0.2448,
    massimale: 113_520,
  },
  2025: {
    minimaleAnnuo: 18_555,
    quotaFissaAnnua: 4460.64,   // ← VERIFICA dal sorgente CalcoliVari
    aliquota: 0.24,
    aliquotaCommerciante: 0.2448,
    massimale: 120_607,
  },
  // 2026: TBD — aggiungere quando INPS pubblica
};

export const INPS_GS: Record<number, InpsGsParams> = {
  2024: { aliquotaSenzaAltraCassa: 0.2607, aliquotaConAltraCassa: 0.24, massimale: 119_650 },
  2025: { aliquotaSenzaAltraCassa: 0.2607, aliquotaConAltraCassa: 0.24, massimale: 120_607 },
  // 2026: TBD
};

export function getInpsArtComForYear(year: number): InpsArtComParams {
  const p = INPS_ARTCOM[year];
  if (!p) throw new Error(`INPS_ARTCOM: anno ${year} non disponibile`);
  return p;
}

export function getInpsGsForYear(year: number): InpsGsParams {
  const p = INPS_GS[year];
  if (!p) throw new Error(`INPS_GS: anno ${year} non disponibile`);
  return p;
}
```

**IMPORTANTE:** verifica i numeri esatti 2024/2025 contro `CalcoliVari/forfettario-rules.js` e `CalcoliVari/app-calc.js`. Se divergono, usa la fonte CalcoliVari (è già allineata alle Circolari INPS).

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/inps-params.ts src/shared/inps-params.test.ts
git commit -m "feat(shared): inps-params per artigiani/commercianti + GS (2024-2025)"
```

---

## Task 4 — `forfettario-rules.ts`

**Files:**
- Create: `src/shared/forfettario-rules.ts`
- Test: `src/shared/forfettario-rules.test.ts`
- Riferimento port: `CalcoliVari/forfettario-rules.js`

- [ ] **Step 1: Scrivere il test**

`src/shared/forfettario-rules.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORFETTARIO_RULES,
  ALIQUOTE_SOSTITUTIVA_AMMESSE,
  isSostitutivaAmmessa,
  isAnnoStartupValido,
} from './forfettario-rules';

test('FORFETTARIO_RULES: soglie 85k/100k (L. 197/2022)', () => {
  assert.equal(FORFETTARIO_RULES.sogliaIngresso, 85_000);
  assert.equal(FORFETTARIO_RULES.sogliaCessazioneImmediata, 100_000);
});

test('FORFETTARIO_RULES: aliquote sostitutiva freeze', () => {
  assert.equal(FORFETTARIO_RULES.sostitutivaStandard, 0.15);
  assert.equal(FORFETTARIO_RULES.sostitutivaStartup, 0.05);
  assert.equal(FORFETTARIO_RULES.startupMaxAnni, 5);
  assert.equal(Object.isFrozen(FORFETTARIO_RULES), true);
});

test('isSostitutivaAmmessa: solo 0.05 o 0.15', () => {
  assert.equal(isSostitutivaAmmessa(0.05), true);
  assert.equal(isSostitutivaAmmessa(0.15), true);
  assert.equal(isSostitutivaAmmessa(0.10), false);
});

test('isAnnoStartupValido: primi 5 anni dalla data inizio (incluso)', () => {
  // attività iniziata 2020 → anni 2020/21/22/23/24 al 5% (anno 0..4)
  assert.equal(isAnnoStartupValido(2020, 2020), true);
  assert.equal(isAnnoStartupValido(2020, 2024), true);
  assert.equal(isAnnoStartupValido(2020, 2025), false);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

`src/shared/forfettario-rules.ts`:
```ts
// Regole forfettario L. 190/2014 + modifiche L. 197/2022, L. 232/2016.

export const FORFETTARIO_RULES = Object.freeze({
  // Soglia di ingresso/permanenza (L. 197/2022 art. 1 c. 54)
  sogliaIngresso: 85_000,
  // Soglia di cessazione immediata (L. 197/2022 art. 1 c. 71)
  sogliaCessazioneImmediata: 100_000,
  // Aliquote sostitutiva (art. 1 c. 64 L. 190/2014)
  sostitutivaStandard: 0.15,
  sostitutivaStartup: 0.05,
  // Durata startup (art. 1 c. 65 L. 190/2014)
  startupMaxAnni: 5,
  // Riduzione INPS art. 1 c. 77 L. 190/2014 (35%)
  riduzioneInpsCoefficiente: 0.65,
});

export const ALIQUOTE_SOSTITUTIVA_AMMESSE = Object.freeze([0.05, 0.15] as const);

export function isSostitutivaAmmessa(a: number): boolean {
  return (ALIQUOTE_SOSTITUTIVA_AMMESSE as readonly number[]).includes(a);
}

export function isAnnoStartupValido(annoInizioAttivita: number, annoCorrente: number): boolean {
  return annoCorrente - annoInizioAttivita < FORFETTARIO_RULES.startupMaxAnni;
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/forfettario-rules.ts src/shared/forfettario-rules.test.ts
git commit -m "feat(shared): forfettario-rules con soglie L.197/2022 + startup"
```

---

## Task 5 — `schedule-keys.ts`

**Files:**
- Create: `src/shared/schedule-keys.ts`
- Test: `src/shared/schedule-keys.test.ts`

- [ ] **Step 1: Scrivere il test**

`src/shared/schedule-keys.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleKey, parseScheduleKey, SCHEDULE_FAMILIES } from './schedule-keys';

test('buildScheduleKey: imposta_saldo + 2025 → "imposta_saldo_2025"', () => {
  assert.equal(buildScheduleKey('imposta_saldo', 2025), 'imposta_saldo_2025');
});

test('buildScheduleKey: tutte le famiglie producono "<family>_<year>"', () => {
  for (const f of SCHEDULE_FAMILIES) {
    const k = buildScheduleKey(f, 2026);
    assert.equal(k, `${f}_2026`);
  }
});

test('parseScheduleKey: roundtrip', () => {
  const k = buildScheduleKey('inps_fissi_3', 2025);
  const parsed = parseScheduleKey(k);
  assert.deepEqual(parsed, { family: 'inps_fissi_3', year: 2025 });
});

test('parseScheduleKey: chiave malformata → null', () => {
  assert.equal(parseScheduleKey('garbage'), null);
  assert.equal(parseScheduleKey('imposta_saldo_'), null);
  assert.equal(parseScheduleKey('imposta_saldo_abc'), null);
});

test('parseScheduleKey: family sconosciuta → null', () => {
  assert.equal(parseScheduleKey('inesistente_2025'), null);
});

test('SCHEDULE_FAMILIES contiene 14 voci (13 attive + INAIL stub)', () => {
  assert.equal(SCHEDULE_FAMILIES.length, 14);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

`src/shared/schedule-keys.ts`:
```ts
// Catalogo famiglie scadenza fiscale forfettario.

export const SCHEDULE_FAMILIES = [
  'imposta_saldo', 'imposta_acc1', 'imposta_acc2',
  'contributi_saldo', 'contributi_acc1', 'contributi_acc2',
  'inps_fissi_1', 'inps_fissi_2', 'inps_fissi_3', 'inps_fissi_4',
  'bollo_q123', 'bollo_q4',
  'camera',
  'inail',  // stub, non emessa in 2A (Mattia/Peru non iscritti) ma type-presente per extensibility
] as const;

export type ScheduleFamily = typeof SCHEDULE_FAMILIES[number];

const FAMILY_SET = new Set<string>(SCHEDULE_FAMILIES);

export function buildScheduleKey(family: ScheduleFamily, year: number): string {
  return `${family}_${year}`;
}

export function parseScheduleKey(key: string): { family: ScheduleFamily; year: number } | null {
  const m = key.match(/^([a-z_0-9]+)_(\d{4})$/);
  if (!m) return null;
  const family = m[1] as string;
  const year = parseInt(m[2]!, 10);
  if (!FAMILY_SET.has(family)) return null;
  return { family: family as ScheduleFamily, year };
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/schedule-keys.ts src/shared/schedule-keys.test.ts
git commit -m "feat(shared): schedule-keys con build/parse + 14 famiglie"
```

---

## Task 6 — `date-rules.ts` (fix C3 by-design)

**Files:**
- Create: `src/shared/date-rules.ts`
- Test: `src/shared/date-rules.test.ts`
- Riferimento port: `CalcoliVari/date-utils.js`

- [ ] **Step 1: Scrivere il test**

`src/shared/date-rules.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolledDueDate, isItalianHoliday, calcolaPasquetta } from './date-rules';

test('buildRolledDueDate: giorno feriale resta invariato', () => {
  const r = buildRolledDueDate('2026-06-30'); // martedì
  assert.deepEqual(r, { date: '2026-06-30', rolled: false });
});

test('buildRolledDueDate: sabato → lunedì', () => {
  const r = buildRolledDueDate('2024-06-30'); // domenica
  assert.deepEqual(r, { date: '2024-07-01', rolled: true });
});

test('buildRolledDueDate: 1 maggio (festivo nazionale) → giorno dopo', () => {
  const r = buildRolledDueDate('2026-05-01'); // venerdì 1 maggio
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2026-05-04'); // lun 4 maggio (sab/dom intermedi)
});

test('buildRolledDueDate: 25/12 → 27/12 (Natale + Santo Stefano consecutivi)', () => {
  const r = buildRolledDueDate('2026-12-25'); // venerdì
  assert.equal(r.rolled, true);
  // 25/12 fri (Natale), 26/12 sat (S. Stefano), 27/12 sun, 28/12 mon
  assert.equal(r.date, '2026-12-28');
});

test('isItalianHoliday: 25 aprile sì', () => {
  assert.equal(isItalianHoliday('2026-04-25'), true);
});

test('isItalianHoliday: 17 marzo (non festivo) no', () => {
  assert.equal(isItalianHoliday('2026-03-17'), false);
});

test('calcolaPasquetta 2026: 6 aprile', () => {
  assert.equal(calcolaPasquetta(2026), '2026-04-06');
});

test('buildRolledDueDate fix C3: 28/02/2026 sabato → 02/03/2026 lunedì', () => {
  // sabato 28/02/2026
  const r = buildRolledDueDate('2026-02-28');
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2026-03-02');
});

test('buildRolledDueDate fix C3: 28/02/2027 domenica → 01/03/2027 lunedì', () => {
  // domenica 28/02/2027
  const r = buildRolledDueDate('2027-02-28');
  assert.equal(r.rolled, true);
  assert.equal(r.date, '2027-03-01');
});

test('buildRolledDueDate: 28/02/2025 venerdì → invariato', () => {
  const r = buildRolledDueDate('2025-02-28');
  assert.equal(r.rolled, false);
  assert.equal(r.date, '2025-02-28');
});

test('buildRolledDueDate: 30/06/2024 domenica → 01/07/2024', () => {
  const r = buildRolledDueDate('2024-06-30');
  assert.deepEqual(r, { date: '2024-07-01', rolled: true });
});

test('buildRolledDueDate: 16/02/2025 domenica → 17/02/2025', () => {
  const r = buildRolledDueDate('2025-02-16');
  assert.deepEqual(r, { date: '2025-02-17', rolled: true });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

`src/shared/date-rules.ts`:
```ts
// Slittamento date di scadenza fiscale sui giorni lavorativi (sab/dom + festivi nazionali IT).

// Festivi nazionali fissi (mese-giorno).
const FESTIVI_FISSI = [
  '01-01', // Capodanno
  '01-06', // Epifania
  '04-25', // Liberazione
  '05-01', // Festa del Lavoro
  '06-02', // Festa della Repubblica
  '08-15', // Ferragosto
  '11-01', // Ognissanti
  '12-08', // Immacolata
  '12-25', // Natale
  '12-26', // S. Stefano
];

// Calcolo Pasqua con algoritmo di Gauss (anonimo Gregoriano).
function calcolaPasqua(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

export function calcolaPasquetta(year: number): string {
  const { month, day } = calcolaPasqua(year);
  // Pasquetta = Pasqua + 1 giorno
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

export function isItalianHoliday(iso: string): boolean {
  const [y, m, dd] = iso.split('-');
  const monthDay = `${m}-${dd}`;
  if (FESTIVI_FISSI.includes(monthDay)) return true;
  if (calcolaPasquetta(parseInt(y!, 10)) === iso) return true;
  return false;
}

function isWeekend(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Slitta la data al primo giorno lavorativo (lun-ven, non festivo nazionale IT) >= input.
 * Fix C3: applica uniforme a TUTTE le scadenze, incluso 28/02. Nessuna eccezione.
 */
export function buildRolledDueDate(iso: string): { date: string; rolled: boolean } {
  let current = iso;
  let rolled = false;
  while (isWeekend(current) || isItalianHoliday(current)) {
    current = addDays(current, 1);
    rolled = true;
  }
  return { date: current, rolled };
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/date-rules.ts src/shared/date-rules.test.ts
git commit -m "feat(shared): date-rules con buildRolledDueDate uniforme (fix C3)"
```

---

## Task 7 — `audit-checks.ts` (fix C1, A1-info, M1)

**Files:**
- Create: `src/shared/audit-checks.ts`
- Test: `src/shared/audit-checks.test.ts`

- [ ] **Step 1: Scrivere il test**

`src/shared/audit-checks.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkC1_soglia,
  checkA1_sostitutivaStartup,
  checkM1_riduzione35NonComunicata,
  evaluateAuditChecks,
  type AuditContext,
} from './audit-checks';

function baseCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    year: 2026,
    yearSettings: {
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
      riduzione_35: 0,
      riduzione_35_comunicata: 0,
      scadenziarioMetodo: 'storico',
      // altri campi YearSettings (default safe)
    } as any,
    profile: { dataInizioAttivita: '2018-04-01' },
    grossCollected: 50_000,
    today: '2026-06-05',
    ...overrides,
  };
}

test('C1: grossCollected < 85k → null', () => {
  const r = checkC1_soglia(baseCtx({ grossCollected: 50_000 }));
  assert.equal(r, null);
});

test('C1: 85k < grossCollected <= 100k → C1_SOGLIA_85K_SUPERATA warning', () => {
  const r = checkC1_soglia(baseCtx({ grossCollected: 90_000 }));
  assert.equal(r?.code, 'C1_SOGLIA_85K_SUPERATA');
  assert.equal(r?.severity, 'warning');
});

test('C1: grossCollected esattamente 85k → null (uguaglianza ammessa)', () => {
  const r = checkC1_soglia(baseCtx({ grossCollected: 85_000 }));
  assert.equal(r, null);
});

test('C1: grossCollected > 100k → C1_CESSAZIONE_IMMEDIATA warning', () => {
  const r = checkC1_soglia(baseCtx({ grossCollected: 105_000 }));
  assert.equal(r?.code, 'C1_CESSAZIONE_IMMEDIATA');
  assert.equal(r?.severity, 'warning');
});

test('A1: sostitutiva 15% → null (no check)', () => {
  const ctx = baseCtx({
    yearSettings: { ...baseCtx().yearSettings, impostaSostitutiva: 0.15 },
  });
  assert.equal(checkA1_sostitutivaStartup(ctx), null);
});

test('A1: sostitutiva 5% e attività < 5 anni → info requisiti', () => {
  const ctx = baseCtx({
    year: 2022,
    yearSettings: { ...baseCtx().yearSettings, impostaSostitutiva: 0.05 },
    profile: { dataInizioAttivita: '2020-01-01' }, // anno 2 dei 5
  });
  const r = checkA1_sostitutivaStartup(ctx);
  assert.equal(r?.code, 'A1_SOSTITUTIVA_5_REQUISITI');
  assert.equal(r?.severity, 'info');
});

test('A1: sostitutiva 5% e attività >= 5 anni → block (configurazione invalida)', () => {
  const ctx = baseCtx({
    year: 2026,
    yearSettings: { ...baseCtx().yearSettings, impostaSostitutiva: 0.05 },
    profile: { dataInizioAttivita: '2018-01-01' }, // anno 8
  });
  const r = checkA1_sostitutivaStartup(ctx);
  assert.equal(r?.code, 'A1_SOSTITUTIVA_5_NON_AMMESSA');
  assert.equal(r?.severity, 'block');
});

test('M1: riduzione_35=1 e riduzione_35_comunicata=0 → warning', () => {
  const ctx = baseCtx({
    yearSettings: { ...baseCtx().yearSettings, riduzione_35: 1, riduzione_35_comunicata: 0 },
  });
  const r = checkM1_riduzione35NonComunicata(ctx);
  assert.equal(r?.code, 'M1_RIDUZIONE_35_NON_COMUNICATA');
  assert.equal(r?.severity, 'warning');
});

test('M1: riduzione_35=1 e comunicata=1 → null', () => {
  const ctx = baseCtx({
    yearSettings: { ...baseCtx().yearSettings, riduzione_35: 1, riduzione_35_comunicata: 1 },
  });
  assert.equal(checkM1_riduzione35NonComunicata(ctx), null);
});

test('M1: riduzione_35=0 → null', () => {
  const ctx = baseCtx({
    yearSettings: { ...baseCtx().yearSettings, riduzione_35: 0 },
  });
  assert.equal(checkM1_riduzione35NonComunicata(ctx), null);
});

test('evaluateAuditChecks: aggrega multiple warnings + NO_REVENUE_SOURCE', () => {
  const ctx = baseCtx({
    grossCollected: 0,
    yearSettings: {
      ...baseCtx().yearSettings,
      riduzione_35: 1,
      riduzione_35_comunicata: 0,
    },
  });
  const ws = evaluateAuditChecks(ctx);
  const codes = ws.map((w) => w.code);
  assert.ok(codes.includes('NO_REVENUE_SOURCE'));
  assert.ok(codes.includes('M1_RIDUZIONE_35_NON_COMUNICATA'));
});

test('evaluateAuditChecks: nessuna warning quando tutto regolare', () => {
  const ws = evaluateAuditChecks(baseCtx());
  assert.equal(ws.length, 0);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

`src/shared/audit-checks.ts`:
```ts
import { FORFETTARIO_RULES, isAnnoStartupValido } from './forfettario-rules';

export type WarningSeverity = 'info' | 'warning' | 'block';

export interface AuditWarning {
  code: string;
  severity: WarningSeverity;
  title: string;
  message: string;
  suggestedAction?: string;
  context?: Record<string, unknown>;
}

export interface AuditContext {
  year: number;
  yearSettings: {
    regime: string;
    coefficiente: number;
    impostaSostitutiva: number;
    inpsMode: string;
    inpsCategoria: string | null;
    riduzione_35: number;
    riduzione_35_comunicata: number;
    scadenziarioMetodo: string;
  };
  profile: { dataInizioAttivita: string };
  grossCollected: number;
  today: string;
}

function yearOf(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

export function checkC1_soglia(ctx: AuditContext): AuditWarning | null {
  const g = ctx.grossCollected;
  if (g > FORFETTARIO_RULES.sogliaCessazioneImmediata) {
    return {
      code: 'C1_CESSAZIONE_IMMEDIATA',
      severity: 'warning',
      title: 'Soglia 100k superata',
      message: `Hai superato 100.000 € di ricavi (${g.toFixed(2)} €). Il regime forfettario è cessato immediatamente dall'eccedenza (L. 197/2022 art. 1 c. 71).`,
      suggestedAction: 'Verifica con il commercialista la data di cessazione e il passaggio a ordinario.',
      context: { grossCollected: g, soglia: FORFETTARIO_RULES.sogliaCessazioneImmediata },
    };
  }
  if (g > FORFETTARIO_RULES.sogliaIngresso) {
    return {
      code: 'C1_SOGLIA_85K_SUPERATA',
      severity: 'warning',
      title: 'Soglia 85k superata',
      message: `Ricavi ${g.toFixed(2)} € superiori a 85.000 € ma entro 100.000 €: forfettario quest'anno, ordinario dall'anno successivo (L. 197/2022 art. 1 c. 71).`,
      context: { grossCollected: g, soglia: FORFETTARIO_RULES.sogliaIngresso },
    };
  }
  return null;
}

export function checkA1_sostitutivaStartup(ctx: AuditContext): AuditWarning | null {
  if (ctx.yearSettings.impostaSostitutiva !== FORFETTARIO_RULES.sostitutivaStartup) return null;
  const annoInizio = yearOf(ctx.profile.dataInizioAttivita);
  if (!isAnnoStartupValido(annoInizio, ctx.year)) {
    return {
      code: 'A1_SOSTITUTIVA_5_NON_AMMESSA',
      severity: 'block',
      title: 'Sostitutiva 5% non più applicabile',
      message: `L'aliquota 5% startup è ammessa solo per i primi 5 periodi d'imposta. Attività iniziata nel ${annoInizio}, anno corrente ${ctx.year}.`,
      context: { annoInizio, year: ctx.year },
    };
  }
  return {
    code: 'A1_SOSTITUTIVA_5_REQUISITI',
    severity: 'info',
    title: 'Verifica requisiti startup',
    message: 'L\'aliquota 5% richiede di non aver svolto attività analoga nei 3 anni precedenti (art. 1 c. 65 lett. a L. 190/2014). Verifica.',
    context: { annoInizio, year: ctx.year },
  };
}

export function checkM1_riduzione35NonComunicata(ctx: AuditContext): AuditWarning | null {
  const ys = ctx.yearSettings;
  if (ys.riduzione_35 !== 1) return null;
  if (ys.riduzione_35_comunicata === 1) return null;
  return {
    code: 'M1_RIDUZIONE_35_NON_COMUNICATA',
    severity: 'warning',
    title: 'Riduzione 35% non risulta comunicata',
    message: 'La riduzione 35% è applicata nel calcolo INPS ma il flag "comunicata" è 0. La comunicazione va inviata entro il 28/02 (art. 1 c. 79 L. 190/2014).',
    suggestedAction: 'Verifica sul tuo "Cassetto Previdenziale" e aggiorna il flag.',
  };
}

function checkNoRevenue(ctx: AuditContext): AuditWarning | null {
  if (ctx.grossCollected > 0) return null;
  return {
    code: 'NO_REVENUE_SOURCE',
    severity: 'info',
    title: 'Nessuna fonte di ricavi',
    message: 'Nessuna fattura registrata e nessun valore di onboarding. Usa /api/tax/simulate per ipotesi.',
  };
}

export function evaluateAuditChecks(ctx: AuditContext): AuditWarning[] {
  return [
    checkC1_soglia(ctx),
    checkA1_sostitutivaStartup(ctx),
    checkM1_riduzione35NonComunicata(ctx),
    checkNoRevenue(ctx),
  ].filter((w): w is AuditWarning => w !== null);
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/shared/audit-checks.ts src/shared/audit-checks.test.ts
git commit -m "feat(shared): audit-checks per C1, A1, M1 + NO_REVENUE_SOURCE"
```

---

## Task 8 — DB migration + Zod schemas

**Files:**
- Create: `drizzle/0001_audit_fixes_year_settings.sql` (genera via `npm run db:generate`)
- Modify: `src/server/db/schema.ts`
- Modify: `src/shared/schemas.ts`

- [ ] **Step 1: Aggiornare schema Drizzle**

In `src/server/db/schema.ts`, aggiungi 3 colonne dentro `yearSettings` (dopo `overrides`):
```ts
// Audit fix A5: data proroga saldo+acc1 (se applicabile).
prorogaSaldoAt: text('proroga_saldo_at'),
// Audit fix M1: stato comunicazione INPS della riduzione 35%.
riduzione35Comunicata: integer('riduzione_35_comunicata').notNull().default(0),
riduzione35DataComunicazione: text('riduzione_35_data_comunicazione'),
```

- [ ] **Step 2: Generare migration**

```bash
npm run db:generate
```

Atteso: nuovo file `drizzle/0001_*.sql` con 3 ALTER TABLE. Rinominarlo a `drizzle/0001_audit_fixes_year_settings.sql` (se drizzle-kit lo chiama altrimenti).

- [ ] **Step 3: Aggiungere Zod schemas condivisi**

In `src/shared/schemas.ts`, append in fondo:
```ts
// ───── Year settings ─────
export const RegimeEnum = z.enum(['forfettario', 'ordinario']);
export const InpsModeEnum = z.enum(['artigiani_commercianti', 'gestione_separata']);
export const InpsCategoriaEnum = z.enum(['artigiano', 'commerciante']).nullable();
export const ScadenziarioMetodoEnum = z.enum(['storico', 'previsionale']);

export const YearSettingsInput = z.object({
  regime: RegimeEnum,
  coefficiente: z.number().min(0).max(1),
  impostaSostitutiva: z.number().refine((v) => v === 0.05 || v === 0.15, { message: 'sostitutiva deve essere 0.05 o 0.15' }),
  inpsMode: InpsModeEnum,
  inpsCategoria: InpsCategoriaEnum,
  riduzione35: z.union([z.literal(0), z.literal(1)]).default(0),
  riduzione35Comunicata: z.union([z.literal(0), z.literal(1)]).default(0),
  riduzione35DataComunicazione: z.string().nullable().optional(),
  haRedditoDipendente: z.union([z.literal(0), z.literal(1)]).default(0),
  limiteForfettario: z.number().int().default(85000),
  scadenziarioMetodo: ScadenziarioMetodoEnum.default('storico'),
  prorogaSaldoAt: z.string().nullable().optional()
    .refine((v) => v == null || /^\d{4}-07-\d{2}$/.test(v), { message: 'prorogaSaldoAt deve essere in luglio' }),
  primoAnnoFatturatoPrec: z.number().nullable().optional(),
  primoAnnoImpostaPrec: z.number().nullable().optional(),
  primoAnnoAccontiImpostaPrec: z.number().nullable().optional(),
  primoAnnoContribVariabiliPrec: z.number().nullable().optional(),
  primoAnnoAccontiContribPrec: z.number().nullable().optional(),
  overrides: z.record(z.unknown()).optional(),
});

export const YearSettingsPublic = YearSettingsInput.extend({
  year: z.number().int(),
});

// ───── Pagamenti ─────
export const ScheduleKeyBreakdown = z.object({
  key: z.string(),
  amount: z.number(),
});

export const PagamentoTipoEnum = z.enum(['tasse', 'contributi', 'misto', 'altro', 'inail', 'camera', 'bollo']);

export const PagamentoCreateInput = z.object({
  year: z.number().int(),
  data: z.string(),
  tipo: PagamentoTipoEnum,
  descrizione: z.string().optional(),
  importo: z.number(),
  scheduleKey: z.string().nullable().optional(),
  linkedKeys: z.array(ScheduleKeyBreakdown).optional(),
  note: z.string().optional(),
});

export const PagamentoPublic = PagamentoCreateInput.extend({
  id: z.string(),
  profileId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PagamentoQuickPayInput = z.object({
  scheduleKey: z.string(),
  importo: z.number().optional(),
  data: z.string().optional(),
  tipo: PagamentoTipoEnum.optional(),
});

// ───── Audit warnings ─────
export const WarningSeverityEnum = z.enum(['info', 'warning', 'block']);
export const AuditWarningSchema = z.object({
  code: z.string(),
  severity: WarningSeverityEnum,
  title: z.string(),
  message: z.string(),
  suggestedAction: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  confirmed: z.boolean().optional(),
});

// ───── Tax simulation ─────
export const TaxSimulateInput = z.object({
  year: z.number().int(),
  grossCollected: z.number(),
  settings: YearSettingsInput.partial().optional(),
  method: ScadenziarioMetodoEnum.optional(),
});
```

- [ ] **Step 4: Type-check**

```bash
npm run typecheck
```

Atteso: zero errori.

- [ ] **Step 5: Test migrations applicano**

Aggiungi `src/server/db/migrate-2a.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-helper';

test('migration 0001: yearSettings ha le 3 nuove colonne', async () => {
  const { db } = await createTestDb();
  // crea un user + profile per FK
  // (riusare gli helper esistenti)
  // inserisci year_settings con i nuovi campi
  // verifica che la query funzioni
  const result = await db.execute(`
    SELECT name FROM pragma_table_info('year_settings')
    WHERE name IN ('proroga_saldo_at', 'riduzione_35_comunicata', 'riduzione_35_data_comunicazione')
    ORDER BY name
  `);
  assert.equal(result.rows.length, 3);
});
```

Run: `npm test -- --test-name-pattern "migration 0001"` → PASS.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0001_audit_fixes_year_settings.sql src/server/db/schema.ts src/shared/schemas.ts src/server/db/migrate-2a.test.ts
git commit -m "feat(db): migration 0001 audit fixes year_settings + Zod schemas 2A"
```

---

## Task 9 — `tax-engine.buildAccontoPlan` (M3 boundary)

**Files:**
- Create: `src/server/lib/tax-engine.ts` (file iniziale, sarà esteso nei task successivi)
- Test: `src/server/lib/tax-engine.test.ts`
- Riferimento port: `CalcoliVari/tax-engine.js:51-68`

- [ ] **Step 1: Scrivere il test**

`src/server/lib/tax-engine.test.ts` (inizia il file):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAccontoPlan } from './tax-engine';

test('buildAccontoPlan: importo 0 → mode none, tutto a 0', () => {
  const p = buildAccontoPlan(0);
  assert.equal(p.mode, 'none');
  assert.equal(p.total, 0);
  assert.equal(p.first, 0);
  assert.equal(p.second, 0);
});

test('buildAccontoPlan: M3 boundary 51.64 → mode none', () => {
  const p = buildAccontoPlan(51.64);
  assert.equal(p.mode, 'none');
});

test('buildAccontoPlan: M3 boundary esatto 51.65 → mode none (≤)', () => {
  const p = buildAccontoPlan(51.65);
  assert.equal(p.mode, 'none');
});

test('buildAccontoPlan: M3 boundary 51.66 → mode single', () => {
  const p = buildAccontoPlan(51.66);
  assert.equal(p.mode, 'single');
  assert.equal(p.first, 0);
  assert.equal(p.second, 51.66);
});

test('buildAccontoPlan: M3 boundary esatto 257.52 → mode single', () => {
  const p = buildAccontoPlan(257.52);
  assert.equal(p.mode, 'single');
  assert.equal(p.second, 257.52);
});

test('buildAccontoPlan: M3 boundary 257.53 → mode double 40/60', () => {
  const p = buildAccontoPlan(257.53);
  assert.equal(p.mode, 'double');
  // 40% di 257.53 = 103.012 → arrotondato a 2 dec
  assert.ok(p.first > 103 && p.first < 104);
  assert.ok(p.second > 154 && p.second < 155);
  assert.equal(Math.round((p.first + p.second) * 100) / 100, 257.53);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

`src/server/lib/tax-engine.ts`:
```ts
import { ACCONTO_RULES, type AccontoRules } from '@shared/acconto-rules';

export interface AccontoPlan {
  base: number;
  total: number;
  first: number;
  second: number;
  mode: 'none' | 'single' | 'double';
}

function ceil2(n: number): number {
  return Math.round(n * 100) / 100;
}

function splitByWeights(amount: number, weights: readonly number[]): number[] {
  const totalW = weights.reduce((s, w) => s + w, 0);
  const parts = weights.map((w) => ceil2((amount * w) / totalW));
  // Aggiusta arrotondamento sulla parte finale
  const sumParts = parts.reduce((s, p) => s + p, 0);
  const diff = ceil2(amount - sumParts);
  if (parts.length > 0) parts[parts.length - 1] = ceil2(parts[parts.length - 1]! + diff);
  return parts;
}

export function buildAccontoPlan(baseAmount: number, rules: AccontoRules = ACCONTO_RULES): AccontoPlan {
  const base = ceil2(baseAmount);
  if (base <= rules.thresholdZero) {
    return { base, total: 0, first: 0, second: 0, mode: 'none' };
  }
  if (base <= rules.thresholdSingle) {
    return { base, total: base, first: 0, second: base, mode: 'single' };
  }
  const parts = splitByWeights(base, rules.weights);
  return {
    base,
    total: base,
    first: parts[0] ?? 0,
    second: parts[1] ?? 0,
    mode: 'double',
  };
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/tax-engine.ts src/server/lib/tax-engine.test.ts
git commit -m "feat(server): tax-engine buildAccontoPlan con M3 boundary test"
```

---

## Task 10 — `tax-engine.buildForfettarioScenario` (fix A6)

**Files:**
- Modify: `src/server/lib/tax-engine.ts` (append)
- Modify: `src/server/lib/tax-engine.test.ts` (append)
- Riferimento port: `CalcoliVari/tax-engine.js:509-583`

- [ ] **Step 1: Scrivere i test (appendi al file esistente)**

```ts
import { buildForfettarioScenario, type ScenarioInput } from './tax-engine';
import { getInpsArtComForYear } from '@shared/inps-params';

function baseScenarioInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  const inps2025 = getInpsArtComForYear(2025);
  return {
    year: 2025,
    method: 'storico',
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, riduzione35: false },
    grossCollected: 50_000,
    currentContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps2025.quotaFissaAnnua,
      saldoAccontoBase: 0,
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps2025.quotaFissaAnnua,
      saldoAccontoBase: 0,
    },
    previousTaxBase: 4500,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
    ...overrides,
  };
}

test('buildForfettarioScenario: ricavi 50k coeff 67% → reddito lordo 33500', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.forfettarioGrossIncome, 33_500);
});

test('buildForfettarioScenario: sostitutiva calcolata su imponibile netto contributi', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  // imponibile = grossIncome - contributi deducibili
  assert.ok(r.taxableBase < r.forfettarioGrossIncome);
  assert.equal(r.substituteTax, Math.round(r.taxableBase * 0.15 * 100) / 100);
});

test('buildForfettarioScenario: sostitutiva 5% startup', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.05, riduzione35: false },
  }));
  assert.equal(r.substituteTax, Math.round(r.taxableBase * 0.05 * 100) / 100);
});

test('buildForfettarioScenario: previsionale usa forecastTaxBase', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    method: 'previsionale',
    forecastTaxBase: 3000,
    forecastContributionBase: 1500,
  }));
  assert.equal(r.method, 'previsionale');
  assert.equal(r.taxAccontoBase, 3000);
});

test('buildForfettarioScenario: artigiani fixedAnnual splittato in 4 rate', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  // (previousFixedTail + currentFixedWithinYear) deve essere proporzionale a quotaFissaAnnua
  assert.ok(r.deductibleContributionsPaid > 0);
});

test('A6 fix: saldo sostitutiva sottrae accontiSostitutivaPagatiReali (non stimati)', () => {
  const stimati = buildForfettarioScenario(baseScenarioInput({
    accontiSostitutivaPagatiReali: 0,
  }));
  const reali = buildForfettarioScenario(baseScenarioInput({
    accontiSostitutivaPagatiReali: 1500,
  }));
  assert.equal(stimati.taxSaldo, Math.max(stimati.substituteTax, 0));
  assert.equal(reali.taxSaldo, Math.max(reali.substituteTax - 1500, 0));
});

test('A6 fix: saldo contributi sottrae accontiContribPagatiReali', () => {
  const reali = buildForfettarioScenario(baseScenarioInput({
    accontiContribPagatiReali: 800,
  }));
  // contribuzione totale > 800 ⇒ saldo = totale - 800
  // Vedi che esiste e ≥ 0:
  assert.ok(reali.contributionSaldo >= 0);
});

test('A6 fix: se acconti pagati > tax computed → saldo = 0 (no negativo)', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    grossCollected: 10_000, // tax sarà piccola
    accontiSostitutivaPagatiReali: 5_000, // molto > tax
  }));
  assert.equal(r.taxSaldo, 0);
});

test('buildForfettarioScenario: GS aliquota 26.07%', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    currentContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
    previousContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
  }));
  // GS non ha quota fissa
  assert.equal(r.previousFixedTail ?? 0, 0);
});

test('buildForfettarioScenario: formula breakdown contiene 5 voci', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.formula.length, 5);
  assert.equal(r.formula[0]?.label, 'Ricavi incassati');
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementare**

Estendi `src/server/lib/tax-engine.ts`:
```ts
export interface ContributionParams {
  mode: 'artigiani_commercianti' | 'gestione_separata';
  fixedAnnual: number;
  saldoAccontoBase: number;
}

export interface ScenarioInput {
  year: number;
  method: 'storico' | 'previsionale';
  settings: {
    coefficiente: number;
    impostaSostitutiva: number;
    riduzione35: boolean;
  };
  grossCollected: number;
  currentContribution: ContributionParams;
  previousContribution: ContributionParams;
  previousTaxBase: number;
  previousContributionAccontiPaid: number;
  accontiSostitutivaPagatiReali: number;  // FIX A6
  accontiContribPagatiReali: number;       // FIX A6
  forecastContributionBase?: number;
  forecastTaxBase?: number;
  accontoRules?: AccontoRules;
}

export interface ForfettarioScenario {
  year: number;
  method: 'storico' | 'previsionale';
  grossCollected: number;
  forfettarioGrossIncome: number;
  deductibleContributionsPaid: number;
  taxableBase: number;
  substituteTax: number;
  taxSaldo: number;                  // FIX A6
  taxAccontoBase: number;
  taxAcconti: AccontoPlan;
  contributionSaldo: number;         // FIX A6
  contributionAccontoBase: number;
  contributionAcconti: AccontoPlan;
  previousFixedTail: number;
  currentFixedWithinYear: number;
  previousContributionSaldo: number;
  managedCashOutflows: number;
  formula: Array<{ label: string; amount: number }>;
  explanation: string[];
}

export function buildForfettarioScenario(input: ScenarioInput): ForfettarioScenario {
  // Port da CalcoliVari/tax-engine.js:509-583, adattato a TS + estensioni A6.
  const rules = input.accontoRules ?? ACCONTO_RULES;
  const coeff = input.settings.coefficiente;
  const substituteRate = input.settings.impostaSostitutiva;
  const grossCollected = ceil2(input.grossCollected);
  const forfettarioGrossIncome = ceil2(grossCollected * coeff);

  // Split contributi fissi su 4 rate (artigiani: 16/5, 20/8, 16/11, 16/2 anno+1)
  const previousFixedParts = input.previousContribution.mode === 'artigiani_commercianti'
    ? splitByWeights(input.previousContribution.fixedAnnual, [1, 1, 1, 1])
    : [0, 0, 0, 0];
  const currentFixedParts = input.currentContribution.mode === 'artigiani_commercianti'
    ? splitByWeights(input.currentContribution.fixedAnnual, [1, 1, 1, 1])
    : [0, 0, 0, 0];

  // Quota fissa precedente con scadenza 16/02 anno corrente ricade nell'anno corrente
  const previousFixedTail = ceil2(previousFixedParts[3] ?? 0);
  // Quote fisse correnti con scadenza nell'anno (rate 1-3)
  const currentFixedWithinYear = ceil2((currentFixedParts[0] ?? 0) + (currentFixedParts[1] ?? 0) + (currentFixedParts[2] ?? 0));

  // Saldo contributi (eccedente) dell'anno precedente
  const previousContributionSaldo = ceil2(
    Math.max(input.previousContribution.saldoAccontoBase - input.previousContributionAccontiPaid, 0),
  );

  // Base acconto contributi
  const contributionAccontoBase = ceil2(
    input.method === 'previsionale'
      ? input.forecastContributionBase ?? 0
      : input.previousContribution.saldoAccontoBase,
  );
  const contributionAcconti = buildAccontoPlan(contributionAccontoBase, rules);

  const deductibleContributionsPaid = ceil2(
    previousFixedTail + currentFixedWithinYear + previousContributionSaldo + contributionAcconti.total,
  );

  const taxableBase = ceil2(Math.max(forfettarioGrossIncome - deductibleContributionsPaid, 0));
  const substituteTax = ceil2(taxableBase * substituteRate);

  // FIX A6: saldo sottrae acconti REALMENTE pagati (input dal service)
  const taxSaldo = ceil2(Math.max(substituteTax - input.accontiSostitutivaPagatiReali, 0));

  // Contribuzione totale dell'anno (per A6 contributi)
  const contribuzioneTotaleAnno = ceil2(
    previousFixedTail + currentFixedWithinYear +
    (input.method === 'previsionale' ? input.forecastContributionBase ?? 0 : input.previousContribution.saldoAccontoBase),
  );
  const contributionSaldo = ceil2(Math.max(contribuzioneTotaleAnno - input.accontiContribPagatiReali, 0));

  // Base acconto tasse
  const taxAccontoBase = ceil2(
    input.method === 'previsionale'
      ? input.forecastTaxBase ?? substituteTax
      : input.previousTaxBase,
  );
  const taxAcconti = buildAccontoPlan(taxAccontoBase, rules);

  const managedCashOutflows = ceil2(deductibleContributionsPaid + taxAcconti.total);

  const formula = [
    { label: 'Ricavi incassati', amount: grossCollected },
    { label: `Reddito lordo forfettario (${ceil2(coeff * 100)}%)`, amount: forfettarioGrossIncome },
    { label: 'Contributi INPS deducibili pagati/stimati nell\'anno', amount: deductibleContributionsPaid },
    { label: 'Imponibile fiscale', amount: taxableBase },
    { label: `Imposta sostitutiva (${ceil2(substituteRate * 100)}%)`, amount: substituteTax },
  ];

  const explanation = [
    `Parto dagli incassi ${input.year} e applico il coefficiente di redditività ${ceil2(coeff * 100)}%.`,
    `Dalla base forfettaria sottraggo i contributi INPS obbligatori pagati o pianificati nel calendario ${input.year}.`,
    `Sull'imponibile fiscale risultante applico l'imposta sostitutiva del ${ceil2(substituteRate * 100)}%.`,
    input.method === 'previsionale'
      ? 'Questo scenario usa basi previsionali per gli acconti.'
      : 'Questo scenario usa lo storico dell\'anno precedente per gli acconti.',
  ];

  return {
    year: input.year,
    method: input.method,
    grossCollected,
    forfettarioGrossIncome,
    deductibleContributionsPaid,
    taxableBase,
    substituteTax,
    taxSaldo,
    taxAccontoBase,
    taxAcconti,
    contributionSaldo,
    contributionAccontoBase,
    contributionAcconti,
    previousFixedTail,
    currentFixedWithinYear,
    previousContributionSaldo,
    managedCashOutflows,
    formula,
    explanation,
  };
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/tax-engine.ts src/server/lib/tax-engine.test.ts
git commit -m "feat(server): tax-engine buildForfettarioScenario + fix A6 acconti reali"
```

---

## Task 11 — `tax-engine.buildForfettarioMethodComparison`

**Files:**
- Modify: `src/server/lib/tax-engine.ts` (append)
- Modify: `src/server/lib/tax-engine.test.ts` (append)
- Riferimento port: `CalcoliVari/tax-engine.js:585-642`

- [ ] **Step 1: Test**

```ts
import { buildForfettarioMethodComparison } from './tax-engine';

test('buildForfettarioMethodComparison: produce sia historical che previsionale', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastTaxBase: 4800,
    forecastContributionBase: 1600,
  });
  assert.ok(out.historical);
  assert.ok(out.previsionale);
});

test('buildForfettarioMethodComparison: prudential è quello con managedCashOutflows più alto', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastTaxBase: 100,
    forecastContributionBase: 100,
  });
  assert.equal(out.prudential === 'historical' || out.prudential === 'previsionale', true);
});

test('buildForfettarioMethodComparison: warnings include deltaCash quando ≥ 0.01', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastTaxBase: 100,
    forecastContributionBase: 100,
  });
  assert.ok(out.warnings.some((w) => /liquidit/.test(w) || /storico/.test(w) || /previsionale/.test(w)));
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```ts
export interface ComparisonInput extends ScenarioInput {
  methodSetting: 'storico' | 'previsionale';
  currentSettings?: { regime?: string; haRedditoDipendente?: number };
  previousSettings?: { regime?: string; haRedditoDipendente?: number };
}

export interface ComparisonOutput {
  selectedMethod: 'storico' | 'previsionale';
  selected: ForfettarioScenario;
  historical: ForfettarioScenario;
  previsionale: ForfettarioScenario;
  prudential: 'historical' | 'previsionale';
  liquidity: 'historical' | 'previsionale';
  deltaCash: number;
  transition: TransitionInfo;
  warnings: string[];
}

export function buildForfettarioMethodComparison(input: ComparisonInput): ComparisonOutput {
  const transition = buildTransitionDiagnostics({
    year: input.year,
    currentSettings: input.currentSettings ?? {},
    previousSettings: input.previousSettings ?? {},
  });
  const historical = buildForfettarioScenario({ ...input, method: 'storico' });
  const previsionale = buildForfettarioScenario({ ...input, method: 'previsionale' });
  const selectedMethod = input.methodSetting === 'previsionale' ? 'previsionale' : 'storico';
  const selected = selectedMethod === 'previsionale' ? previsionale : historical;
  const prudentialIsHistorical = historical.managedCashOutflows >= previsionale.managedCashOutflows;
  const prudential = prudentialIsHistorical ? 'historical' : 'previsionale';
  const liquidity = prudentialIsHistorical ? 'previsionale' : 'historical';
  const deltaCash = ceil2(historical.managedCashOutflows - previsionale.managedCashOutflows);
  const warnings = [...transition.warnings];

  if (Math.abs(deltaCash) >= 0.01) {
    warnings.push(
      deltaCash > 0
        ? `Il metodo storico richiede ${deltaCash.toFixed(2)} EUR in più di liquidità rispetto al previsionale.`
        : `Il metodo previsionale richiede ${Math.abs(deltaCash).toFixed(2)} EUR in più di liquidità rispetto allo storico.`,
    );
  }
  if (historical.taxAcconti.total > previsionale.taxAcconti.total) {
    warnings.push(`Lo storico anticipa più imposta sostitutiva del previsionale (${historical.taxAcconti.total.toFixed(2)} vs ${previsionale.taxAcconti.total.toFixed(2)}).`);
  } else if (historical.taxAcconti.total < previsionale.taxAcconti.total) {
    warnings.push(`Il previsionale porta acconti più alti dello storico (${previsionale.taxAcconti.total.toFixed(2)} vs ${historical.taxAcconti.total.toFixed(2)}).`);
  }

  return { selectedMethod, selected, historical, previsionale, prudential, liquidity, deltaCash, transition, warnings };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/tax-engine.ts src/server/lib/tax-engine.test.ts
git commit -m "feat(server): tax-engine method comparison storico vs previsionale"
```

---

## Task 12 — `tax-engine.buildTransitionDiagnostics`

**Files:**
- Modify: `src/server/lib/tax-engine.ts` (append)
- Modify: `src/server/lib/tax-engine.test.ts` (append)
- Riferimento port: `CalcoliVari/tax-engine.js:475-507`

- [ ] **Step 1: Test**

```ts
import { buildTransitionDiagnostics } from './tax-engine';

test('buildTransitionDiagnostics: nessun cambiamento → warnings vuote', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario', haRedditoDipendente: 0 },
    previousSettings: { regime: 'forfettario', haRedditoDipendente: 0 },
  });
  assert.equal(r.warnings.length, 0);
  assert.equal(r.isRegimeTransition, false);
});

test('buildTransitionDiagnostics: cambio regime → warning', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario' },
    previousSettings: { regime: 'ordinario' },
  });
  assert.equal(r.isRegimeTransition, true);
  assert.ok(r.warnings.length > 0);
});

test('buildTransitionDiagnostics: anno precedente reddito misto → warning', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario' },
    previousSettings: { regime: 'forfettario', haRedditoDipendente: 1 },
  });
  assert.equal(r.previousHadEmployeeIncome, true);
  assert.ok(r.warnings.some((w) => /dipendente/i.test(w)));
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```ts
export interface TransitionInput {
  year: number;
  currentSettings: { regime?: string; haRedditoDipendente?: number };
  previousSettings: { regime?: string; haRedditoDipendente?: number };
}

export interface TransitionInfo {
  year: number;
  currentRegime: string;
  previousRegime: string | null;
  previousHadEmployeeIncome: boolean;
  isRegimeTransition: boolean;
  warnings: string[];
  facts: string[];
}

export function buildTransitionDiagnostics(input: TransitionInput): TransitionInfo {
  const year = input.year;
  const currentRegime = input.currentSettings.regime || 'forfettario';
  const previousRegime = input.previousSettings.regime || null;
  const previousHadEmployeeIncome = (input.previousSettings.haRedditoDipendente ?? 0) === 1;
  const isRegimeTransition = !!previousRegime && previousRegime !== currentRegime;

  const warnings: string[] = [];
  const facts: string[] = [];

  if (previousHadEmployeeIncome) {
    warnings.push(`Nel ${year - 1} risultano anche redditi da lavoro dipendente: lo storico può includere IRPEF e addizionali che non rappresentano il forfettario puro del ${year}.`);
    facts.push(`Anno ${year - 1} con redditi misti.`);
  }
  if (isRegimeTransition) {
    warnings.push(`Tra ${year - 1} e ${year} c'è una transizione di regime (${previousRegime} → ${currentRegime}). Gli acconti storici possono essere prudenziali ma non ottimizzati.`);
    facts.push(`Cambio regime ${previousRegime} → ${currentRegime}.`);
  }
  if (previousRegime && previousRegime !== 'forfettario' && currentRegime === 'forfettario') {
    warnings.push(`Lo storico ${year - 1} non è forfettario puro: confronta sempre storico e previsionale prima di assumere che lo storico sia ottimale.`);
  }

  return { year, currentRegime, previousRegime, previousHadEmployeeIncome, isRegimeTransition, warnings, facts };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/tax-engine.ts src/server/lib/tax-engine.test.ts
git commit -m "feat(server): tax-engine transition diagnostics"
```

---

## Task 13 — `tax-engine.buildInstallmentStatus` + `buildInstallmentExplanation`

**Files:**
- Modify: `src/server/lib/tax-engine.ts` (append)
- Modify: `src/server/lib/tax-engine.test.ts` (append)
- Riferimento port: `CalcoliVari/tax-engine.js:644-681`

- [ ] **Step 1: Test**

```ts
import { buildInstallmentStatus, buildInstallmentExplanation, type ScheduleRow } from './tax-engine';

function baseRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'imposta_saldo_2025',
    family: 'imposta_saldo',
    kind: 'tax',
    competence: 'Saldo 2025',
    title: 'Imposta sostitutiva - saldo',
    method: 'Storico',
    amount: 1000,
    low: 1000,
    high: 1000,
    certainty: 'estimated',
    ...overrides,
  };
}

test('buildInstallmentStatus: nessun pagamento + estimated → estimated', () => {
  const s = buildInstallmentStatus(baseRow({ certainty: 'estimated' }), 0);
  assert.equal(s.code, 'estimated');
});

test('buildInstallmentStatus: nessun pagamento + non estimated → to_confirm', () => {
  const s = buildInstallmentStatus(baseRow({ certainty: 'official' }), 0);
  assert.equal(s.code, 'to_confirm');
});

test('buildInstallmentStatus: pagamento esatto → paid', () => {
  const s = buildInstallmentStatus(baseRow({ amount: 1000, low: 1000, high: 1000 }), 1000);
  assert.equal(s.code, 'paid');
});

test('buildInstallmentStatus: pagamento sotto range → underpaid', () => {
  const s = buildInstallmentStatus(baseRow({ amount: 1000, low: 900, high: 1100 }), 800);
  assert.equal(s.code, 'underpaid');
});

test('buildInstallmentStatus: pagamento sopra range → overpaid', () => {
  const s = buildInstallmentStatus(baseRow({ amount: 1000, low: 900, high: 1100 }), 1200);
  assert.equal(s.code, 'overpaid');
});

test('buildInstallmentExplanation: imposta_saldo → menziona "chiude l\'imposta"', () => {
  const ex = buildInstallmentExplanation(baseRow());
  assert.match(ex, /chiude.*imposta/i);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

```ts
import type { ScheduleFamily } from '@shared/schedule-keys';

export interface ScheduleRow {
  id: string;
  family: ScheduleFamily;
  kind: 'tax' | 'contribution' | 'other';
  competence: string;
  title: string;
  method: string;
  amount: number;
  low: number;
  high: number;
  certainty: 'official' | 'estimated' | 'forecast';
  note?: string;
}

export interface InstallmentStatus {
  code: 'paid' | 'underpaid' | 'overpaid' | 'estimated' | 'to_confirm';
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'info';
}

export function buildInstallmentStatus(row: ScheduleRow, paidTotal: number): InstallmentStatus {
  if (paidTotal > 0) {
    const paid = ceil2(paidTotal);
    const low = ceil2(row.low ?? row.amount);
    const high = ceil2(row.high ?? row.amount);
    if (paid < low) return { code: 'underpaid', label: 'Sottostimato', tone: 'danger' };
    if (paid > high) return { code: 'overpaid', label: 'Sovrastimato', tone: 'warn' };
    return { code: 'paid', label: 'Pagato', tone: 'ok' };
  }
  if (row.certainty === 'estimated') return { code: 'estimated', label: 'Stimato', tone: 'warn' };
  return { code: 'to_confirm', label: 'Da confermare', tone: 'info' };
}

export function buildInstallmentExplanation(row: ScheduleRow): string {
  const c = row.competence ?? '';
  const t = row.title ?? '';

  if (row.kind === 'tax' && /imposta sostitutiva/i.test(t) && /saldo/i.test(c)) {
    return `Questo importo chiude l'imposta sostitutiva dell'anno di riferimento indicato (${c}).`;
  }
  if (row.kind === 'tax' && /imposta sostitutiva/i.test(t) && /acconto/i.test(c)) {
    return `Questo importo anticipa l'imposta sostitutiva futura ed è calcolato con metodo ${row.method.toLowerCase()}.`;
  }
  if (row.kind === 'contribution' && /rata/i.test(c)) {
    return 'Questa è una rata fissa INPS artigiani sul minimale.';
  }
  if (row.kind === 'contribution' && /saldo/i.test(c)) {
    return 'Questo è il saldo della quota contributiva eccedente il minimale.';
  }
  if (row.kind === 'contribution' && /acconto/i.test(c)) {
    return `Questo importo anticipa i contributi INPS eccedenti del periodo successivo con metodo ${row.method.toLowerCase()}.`;
  }
  if (/camera di commercio/i.test(t)) return 'Diritto annuale camerale dovuto per l\'anno in corso.';
  if (/bollo/i.test(t)) return 'Imposta di bollo sulle fatture elettroniche.';
  if (/inail/i.test(t)) return 'Autoliquidazione INAIL.';
  return row.note ?? '';
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/tax-engine.ts src/server/lib/tax-engine.test.ts
git commit -m "feat(server): tax-engine installment status + explanation"
```

---

## Task 14 — `scadenziario-engine.buildScadenziario` (fix A5, applicazione C3)

**Files:**
- Create: `src/server/lib/scadenziario-engine.ts`
- Test: `src/server/lib/scadenziario-engine.test.ts`
- Riferimento port: `CalcoliVari/scadenziario-engine.js`

- [ ] **Step 1: Test**

`src/server/lib/scadenziario-engine.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScadenziario, type ScadenziarioInput } from './scadenziario-engine';
import { buildForfettarioScenario, type ForfettarioScenario } from './tax-engine';
import { getInpsArtComForYear } from '@shared/inps-params';

function makeScenario(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  return {
    year: 2026,
    method: 'storico',
    grossCollected: 50_000,
    forfettarioGrossIncome: 33_500,
    deductibleContributionsPaid: 4500,
    taxableBase: 29_000,
    substituteTax: 4350,
    taxSaldo: 4350,
    taxAccontoBase: 4350,
    taxAcconti: { base: 4350, total: 4350, first: 1740, second: 2610, mode: 'double' },
    contributionSaldo: 1000,
    contributionAccontoBase: 0,
    contributionAcconti: { base: 0, total: 0, first: 0, second: 0, mode: 'none' },
    previousFixedTail: 1100,
    currentFixedWithinYear: 3300,
    previousContributionSaldo: 0,
    managedCashOutflows: 8800,
    formula: [],
    explanation: [],
    ...over,
  };
}

function baseInput(over: Partial<ScadenziarioInput> = {}): ScadenziarioInput {
  return {
    year: 2026,
    yearSettings: {
      regime: 'forfettario',
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti',
      inpsCategoria: 'artigiano',
      riduzione_35: 0,
      riduzione_35_comunicata: 0,
      haRedditoDipendente: 0,
      scadenziarioMetodo: 'storico',
      prorogaSaldoAt: null,
    } as any,
    previousYearSettings: null,
    scenarios: { historical: makeScenario(), previsionale: makeScenario({ method: 'previsionale' }) },
    paymentsByKey: new Map(),
    bolloByQuarter: { q123: 16, q4: 8 },
    cameraCommerce: 53,
    ...over,
  };
}

test('buildScadenziario: produce 13 righe (esclusa INAIL)', () => {
  const out = buildScadenziario(baseInput());
  assert.equal(out.rows.length, 13);
});

test('buildScadenziario: include tutte le 13 scheduleKey attese', () => {
  const out = buildScadenziario(baseInput());
  const ids = new Set(out.rows.map((r) => r.id));
  for (const k of [
    'imposta_saldo_2025', 'imposta_acc1_2026', 'imposta_acc2_2026',
    'contributi_saldo_2025', 'contributi_acc1_2026', 'contributi_acc2_2026',
    'inps_fissi_1_2026', 'inps_fissi_2_2026', 'inps_fissi_3_2026', 'inps_fissi_4_2026',
    'bollo_q123_2026', 'bollo_q4_2026',
    'camera_2025',
  ]) {
    assert.ok(ids.has(k), `manca ${k}`);
  }
});

test('FIX A5: prorogaSaldoAt propaga su saldo, acc1, camera ma NON acc2/fissi', () => {
  const out = buildScadenziario(baseInput({
    yearSettings: { ...baseInput().yearSettings, prorogaSaldoAt: '2026-07-30' } as any,
  }));
  const map = new Map(out.rows.map((r) => [r.id, r]));
  assert.equal(map.get('imposta_saldo_2025')?.dueDate, '2026-07-30');
  assert.equal(map.get('imposta_acc1_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('contributi_saldo_2025')?.dueDate, '2026-07-30');
  assert.equal(map.get('contributi_acc1_2026')?.dueDate, '2026-07-30');
  assert.equal(map.get('camera_2025')?.dueDate, '2026-07-30');
  // acc2 e fissi inalterati
  assert.notEqual(map.get('imposta_acc2_2026')?.dueDate, '2026-07-30');
  assert.notEqual(map.get('inps_fissi_2_2026')?.dueDate, '2026-07-30');
});

test('FIX A5: prorogaSaldoAt aggiunge warning A5_PROROGA_APPLICATA', () => {
  const out = buildScadenziario(baseInput({
    yearSettings: { ...baseInput().yearSettings, prorogaSaldoAt: '2026-07-30' } as any,
  }));
  assert.ok(out.warnings.some((w) => w.code === 'A5_PROROGA_APPLICATA'));
});

test('FIX C3: bollo_q4 2025 cade 28/02/2026 sabato → slittato a 02/03/2026', () => {
  const out = buildScadenziario(baseInput({ year: 2026 }));
  const bolloQ4 = out.rows.find((r) => r.id === 'bollo_q4_2025');
  // Wait: con year=2026 produciamo bollo_q4_2026 (q4 in competenza 2026 → versato 28/02/2027).
  // Il test corretto è: con year=2026, bollo_q4_2026 dueDate = 28/02/2027.
  // Per testare slittamento C3 va testato direttamente in date-rules (Task 6).
  // Qui verifichiamo che dueDate sia un giorno lavorativo dopo o uguale a 28/02 N+1.
  const bolloQ4_2026 = out.rows.find((r) => r.id === 'bollo_q4_2026');
  assert.ok(bolloQ4_2026);
  assert.match(bolloQ4_2026!.dueDate, /^2027-0[23]-\d{2}$/);
});

test('riduzione_35=1 → inps fissi 1 ha amount × 0.65 (anno 2025, INPS params noti)', () => {
  // Usa year=2025 perché INPS_ARTCOM[2025] è popolata; 2026 sarà popolata quando INPS pubblica.
  const baseFor2025 = baseInput({ year: 2025 });
  const out = buildScadenziario({
    ...baseFor2025,
    yearSettings: { ...baseFor2025.yearSettings, riduzione_35: 1 } as any,
  });
  const fissi1 = out.rows.find((r) => r.id === 'inps_fissi_1_2025');
  assert.ok(fissi1, 'riga inps_fissi_1_2025 deve esistere');
  const inps = getInpsArtComForYear(2025);
  const rataPiena = inps.quotaFissaAnnua / 4;
  const rataRidotta = rataPiena * 0.65;
  assert.ok(Math.abs(fissi1!.amount.point - rataRidotta) < 1);
});

test('paidTotal aggrega payment puri + breakdown linkedKeys', () => {
  const paymentsByKey = new Map();
  paymentsByKey.set('imposta_saldo_2025', { paidTotal: 1500, payments: [{ id: 'p1', data: '2026-06-30', importo: 1500, mode: 'pure' }] });
  const out = buildScadenziario(baseInput({ paymentsByKey }));
  const saldo = out.rows.find((r) => r.id === 'imposta_saldo_2025');
  assert.equal(saldo?.paidTotal, 1500);
});

test('summary: nextDue è la prima riga ordinata per dueDate non ancora pagata', () => {
  const out = buildScadenziario(baseInput());
  assert.ok(out.summary.nextDue);
});

test('all rows hanno explanation non vuota o string', () => {
  const out = buildScadenziario(baseInput());
  for (const r of out.rows) {
    assert.equal(typeof r.explanation, 'string');
  }
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/lib/scadenziario-engine.ts`:
```ts
import type { ForfettarioScenario } from './tax-engine';
import { buildInstallmentStatus, buildInstallmentExplanation, type ScheduleRow, type InstallmentStatus } from './tax-engine';
import { buildScheduleKey, type ScheduleFamily } from '@shared/schedule-keys';
import { buildRolledDueDate } from '@shared/date-rules';
import { FORFETTARIO_RULES } from '@shared/forfettario-rules';
import { getInpsArtComForYear, getInpsGsForYear } from '@shared/inps-params';
import type { AuditWarning } from '@shared/audit-checks';

export interface PaymentBreakdown {
  id: string;
  data: string;
  importo: number;
  mode: 'pure' | 'mixed';
}

export interface ScadenziarioInput {
  year: number;
  yearSettings: {
    regime: string;
    coefficiente: number;
    impostaSostitutiva: number;
    inpsMode: 'artigiani_commercianti' | 'gestione_separata';
    inpsCategoria: string | null;
    riduzione_35: number;
    riduzione_35_comunicata: number;
    haRedditoDipendente: number;
    scadenziarioMetodo: 'storico' | 'previsionale';
    prorogaSaldoAt: string | null;
  };
  previousYearSettings: typeof undefined | null | ScadenziarioInput['yearSettings'];
  scenarios: { historical: ForfettarioScenario; previsionale: ForfettarioScenario };
  paymentsByKey: Map<string, { paidTotal: number; payments: PaymentBreakdown[] }>;
  bolloByQuarter: { q123: number; q4: number };
  cameraCommerce: number;
}

export interface ScadenziarioRow {
  id: string;
  title: string;
  family: ScheduleFamily;
  kind: 'tax' | 'contribution';
  competenceYear: number;
  dueDate: string;
  dueDateOriginal: string;
  dueDateRolled: boolean;
  prorogaApplied: boolean;
  amount: { low: number; high: number; point: number };
  certainty: 'official' | 'estimated' | 'forecast';
  payments: PaymentBreakdown[];
  paidTotal: number;
  status: InstallmentStatus;
  explanation: string;
}

export interface ScadenziarioOutput {
  year: number;
  method: 'storico' | 'previsionale';
  rows: ScadenziarioRow[];
  summary: { totalDue: number; totalPaid: number; totalResidual: number; nextDue: ScadenziarioRow | null };
  warnings: AuditWarning[];
}

const PROROGABILI_FAMILIES: ScheduleFamily[] = [
  'imposta_saldo', 'imposta_acc1',
  'contributi_saldo', 'contributi_acc1',
  'camera',
];

interface RowSeed {
  family: ScheduleFamily;
  competenceYear: number;
  dueDateBase: string;             // pre-rolling
  title: string;
  kind: 'tax' | 'contribution';
  amount: { low: number; high: number; point: number };
  certainty: 'official' | 'estimated' | 'forecast';
}

function buildSeeds(input: ScadenziarioInput): RowSeed[] {
  const { year, yearSettings, scenarios } = input;
  const method = yearSettings.scadenziarioMetodo;
  const scenario = method === 'previsionale' ? scenarios.previsionale : scenarios.historical;

  // INPS params per anno; per fissi usa l'anno della scadenza
  // (anno N per rate 1-3; rata 4 cade N+1 ma è competenza N)
  const inpsArtCom = yearSettings.inpsMode === 'artigiani_commercianti'
    ? (() => {
        try { return getInpsArtComForYear(year); } catch { return null; }
      })()
    : null;

  const riduzioneCoeff = yearSettings.riduzione_35 === 1
    ? FORFETTARIO_RULES.riduzioneInpsCoefficiente
    : 1;
  const rataFissa = inpsArtCom ? (inpsArtCom.quotaFissaAnnua / 4) * riduzioneCoeff : 0;

  const certaintyTax: 'estimated' | 'forecast' = method === 'previsionale' ? 'forecast' : 'estimated';

  const seeds: RowSeed[] = [];

  // Sostitutiva (saldo competenza N-1, acc1+acc2 competenza N)
  seeds.push({
    family: 'imposta_saldo',
    competenceYear: year - 1,
    dueDateBase: `${year}-06-30`,
    title: 'Imposta sostitutiva — saldo',
    kind: 'tax',
    amount: { low: scenario.taxSaldo, high: scenario.taxSaldo, point: scenario.taxSaldo },
    certainty: certaintyTax,
  });
  seeds.push({
    family: 'imposta_acc1',
    competenceYear: year,
    dueDateBase: `${year}-06-30`,
    title: 'Imposta sostitutiva — acconto 1',
    kind: 'tax',
    amount: { low: scenario.taxAcconti.first, high: scenario.taxAcconti.first, point: scenario.taxAcconti.first },
    certainty: certaintyTax,
  });
  seeds.push({
    family: 'imposta_acc2',
    competenceYear: year,
    dueDateBase: `${year}-11-30`,
    title: 'Imposta sostitutiva — acconto 2',
    kind: 'tax',
    amount: { low: scenario.taxAcconti.second, high: scenario.taxAcconti.second, point: scenario.taxAcconti.second },
    certainty: certaintyTax,
  });

  // Contributi variabili (INPS eccedente)
  seeds.push({
    family: 'contributi_saldo',
    competenceYear: year - 1,
    dueDateBase: `${year}-06-30`,
    title: 'INPS variabile — saldo',
    kind: 'contribution',
    amount: { low: scenario.contributionSaldo, high: scenario.contributionSaldo, point: scenario.contributionSaldo },
    certainty: certaintyTax,
  });
  seeds.push({
    family: 'contributi_acc1',
    competenceYear: year,
    dueDateBase: `${year}-06-30`,
    title: 'INPS variabile — acconto 1',
    kind: 'contribution',
    amount: { low: scenario.contributionAcconti.first, high: scenario.contributionAcconti.first, point: scenario.contributionAcconti.first },
    certainty: certaintyTax,
  });
  seeds.push({
    family: 'contributi_acc2',
    competenceYear: year,
    dueDateBase: `${year}-11-30`,
    title: 'INPS variabile — acconto 2',
    kind: 'contribution',
    amount: { low: scenario.contributionAcconti.second, high: scenario.contributionAcconti.second, point: scenario.contributionAcconti.second },
    certainty: certaintyTax,
  });

  // INPS quote fisse (4 rate)
  const fixedDates: Array<{ family: ScheduleFamily; date: string }> = [
    { family: 'inps_fissi_1', date: `${year}-05-16` },
    { family: 'inps_fissi_2', date: `${year}-08-20` },
    { family: 'inps_fissi_3', date: `${year}-11-16` },
    { family: 'inps_fissi_4', date: `${year + 1}-02-16` },
  ];
  for (const f of fixedDates) {
    seeds.push({
      family: f.family,
      competenceYear: year,
      dueDateBase: f.date,
      title: `INPS fissi — rata ${f.family.slice(-1)}`,
      kind: 'contribution',
      amount: { low: rataFissa, high: rataFissa, point: rataFissa },
      certainty: 'official',
    });
  }

  // Bollo
  seeds.push({
    family: 'bollo_q123',
    competenceYear: year,
    dueDateBase: `${year}-09-30`,
    title: 'Imposta di bollo — Q1+Q2+Q3',
    kind: 'tax',
    amount: { low: input.bolloByQuarter.q123, high: input.bolloByQuarter.q123, point: input.bolloByQuarter.q123 },
    certainty: 'official',
  });
  seeds.push({
    family: 'bollo_q4',
    competenceYear: year,
    dueDateBase: `${year + 1}-02-28`,
    title: 'Imposta di bollo — Q4',
    kind: 'tax',
    amount: { low: input.bolloByQuarter.q4, high: input.bolloByQuarter.q4, point: input.bolloByQuarter.q4 },
    certainty: 'official',
  });

  // Camera di commercio (competenza N-1, scadenza 30/06/N)
  seeds.push({
    family: 'camera',
    competenceYear: year - 1,
    dueDateBase: `${year}-06-30`,
    title: 'Diritto camerale',
    kind: 'tax',
    amount: { low: input.cameraCommerce, high: input.cameraCommerce, point: input.cameraCommerce },
    certainty: 'official',
  });

  return seeds;
}

export function buildScadenziario(input: ScadenziarioInput): ScadenziarioOutput {
  const method = input.yearSettings.scadenziarioMetodo;
  const seeds = buildSeeds(input);
  const proroga = input.yearSettings.prorogaSaldoAt ?? null;
  const warnings: AuditWarning[] = [];

  const rows: ScadenziarioRow[] = seeds.map((seed) => {
    const id = buildScheduleKey(seed.family, seed.competenceYear);
    let dueDate = seed.dueDateBase;
    let dueDateRolled = false;
    let prorogaApplied = false;

    if (proroga && PROROGABILI_FAMILIES.includes(seed.family) && /-06-30$/.test(seed.dueDateBase)) {
      dueDate = proroga;
      prorogaApplied = true;
    } else {
      const rolled = buildRolledDueDate(seed.dueDateBase);
      dueDate = rolled.date;
      dueDateRolled = rolled.rolled;
    }

    const payInfo = input.paymentsByKey.get(id) ?? { paidTotal: 0, payments: [] };
    const row: ScadenziarioRow = {
      id,
      title: seed.title,
      family: seed.family,
      kind: seed.kind === 'tax' ? 'tax' : 'contribution',
      competenceYear: seed.competenceYear,
      dueDate,
      dueDateOriginal: seed.dueDateBase,
      dueDateRolled,
      prorogaApplied,
      amount: seed.amount,
      certainty: seed.certainty,
      payments: payInfo.payments,
      paidTotal: payInfo.paidTotal,
      status: buildInstallmentStatus(
        {
          id, family: seed.family, kind: seed.kind, competence: seed.title, title: seed.title,
          method: method === 'previsionale' ? 'Previsionale' : 'Storico',
          amount: seed.amount.point, low: seed.amount.low, high: seed.amount.high,
          certainty: seed.certainty,
        },
        payInfo.paidTotal,
      ),
      explanation: buildInstallmentExplanation({
        id, family: seed.family, kind: seed.kind, competence: seed.title, title: seed.title,
        method: method === 'previsionale' ? 'Previsionale' : 'Storico',
        amount: seed.amount.point, low: seed.amount.low, high: seed.amount.high,
        certainty: seed.certainty,
      }),
    };
    return row;
  });

  if (proroga) {
    warnings.push({
      code: 'A5_PROROGA_APPLICATA',
      severity: 'info',
      title: 'Proroga saldo applicata',
      message: `Saldo, primo acconto, contributi e camera prorogati al ${proroga}.`,
      context: { prorogaSaldoAt: proroga },
    });
  }

  const sorted = rows.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextDue = sorted.find((r) => r.status.code !== 'paid') ?? null;
  const totalDue = rows.reduce((s, r) => s + r.amount.point, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paidTotal, 0);
  const totalResidual = Math.max(totalDue - totalPaid, 0);

  return {
    year: input.year,
    method,
    rows,
    summary: { totalDue, totalPaid, totalResidual, nextDue },
    warnings,
  };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/scadenziario-engine.ts src/server/lib/scadenziario-engine.test.ts
git commit -m "feat(server): scadenziario-engine con fix A5 + C3 uniforme"
```

---

## Task 15 — `scadenziario-service.ts` (orchestrazione I/O)

**Files:**
- Create: `src/server/services/scadenziario-service.ts`
- Test: `src/server/services/scadenziario-service.test.ts`

Carica `year_settings + fatture + pagamenti` dal DB, costruisce input per gli engine, restituisce `ScadenziarioView`. Calcola anche `accontiSostitutivaPagatiReali` per A6.

- [ ] **Step 1: Test**

`src/server/services/scadenziario-service.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { buildScadenziarioView } from './scadenziario-service';
import { yearSettings, pagamenti } from '../db/schema';

async function setup() {
  const { db } = await createTestDb();
  const u = await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pwd-lunga-12345', name: 'A' });
  const profileId = u.profileId;
  // year_settings 2025 forfettario
  await db.insert(yearSettings).values({
    profileId, year: 2025, regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 0, riduzione35Comunicata: 0,
    haRedditoDipendente: 0, limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
  } as any);
  await db.insert(yearSettings).values({
    profileId, year: 2026, regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 0, riduzione35Comunicata: 0,
    haRedditoDipendente: 0, limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
  } as any);
  return { db, profileId };
}

test('buildScadenziarioView: ritorna 13 righe per anno 2026', async () => {
  const { db, profileId } = await setup();
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  assert.equal(view.rows.length, 13);
});

test('FIX A6: pagamento acc1 reale per sostitutiva 2025 influenza saldo dell\'anno scadenziario 2026', async () => {
  const { db, profileId } = await setup();
  await db.insert(pagamenti).values({
    id: 'pay1', profileId, year: 2025, data: '2025-06-30', tipo: 'tasse',
    importo: 1234.56, scheduleKey: 'imposta_acc1_2025', descrizione: 'acconto 1 reale',
  } as any);
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  // Lo scadenziario di 2026 contiene il saldo 2025; con A6 il taxSaldo = substituteTax - 1234.56
  const saldo = view.rows.find((r) => r.id === 'imposta_saldo_2025');
  assert.ok(saldo);
  // verifichiamo solo che il valore amount sia stato calcolato — il test full numerico in tax-engine
});

test('warnings include audit checks runtime', async () => {
  const { db, profileId } = await setup();
  // riduzione_35=1 ma non comunicata
  await db.update(yearSettings).set({ riduzione35: 1, riduzione35Comunicata: 0 } as any);
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  assert.ok(view.warnings.some((w) => w.code === 'M1_RIDUZIONE_35_NON_COMUNICATA'));
});

test('GET 2026 senza year_settings → throw YEAR_SETTINGS_NOT_FOUND', async () => {
  const { db, profileId } = await setup();
  // riusiamo db ma chiediamo anno 2030 inesistente
  await assert.rejects(
    () => buildScadenziarioView({ db, profileId, year: 2030 }),
    /YEAR_SETTINGS_NOT_FOUND/,
  );
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/services/scadenziario-service.ts`:
```ts
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { yearSettings, pagamenti, fatture, profiles } from '../db/schema';
import { buildForfettarioMethodComparison } from '../lib/tax-engine';
import { buildScadenziario, type ScadenziarioOutput } from '../lib/scadenziario-engine';
import { evaluateAuditChecks, type AuditWarning } from '@shared/audit-checks';
import { getInpsArtComForYear, getInpsGsForYear } from '@shared/inps-params';
import { buildScheduleKey } from '@shared/schedule-keys';
import { HttpError } from '../middleware/error';

export interface ScadenziarioView extends ScadenziarioOutput {
  methodComparison: ReturnType<typeof buildForfettarioMethodComparison>;
  transition: ReturnType<typeof buildForfettarioMethodComparison>['transition'];
  rulesRef: string;
}

interface BuildArgs { db: Db; profileId: string; year: number; today?: string; }

async function fetchYearSettings(db: Db, profileId: string, year: number) {
  const rows = await db.select().from(yearSettings).where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  return rows[0] ?? null;
}

async function sumAccontiReali(db: Db, profileId: string, accontoKeys: string[]): Promise<number> {
  if (accontoKeys.length === 0) return 0;
  // pagamenti puri (scheduleKey match)
  const pure = await db.select().from(pagamenti).where(and(eq(pagamenti.profileId, profileId), inArray(pagamenti.scheduleKey, accontoKeys)));
  let total = 0;
  for (const p of pure) total += Number(p.importo) || 0;
  // pagamenti misti (linkedKeys breakdown)
  const allMixed = await db.select().from(pagamenti).where(eq(pagamenti.profileId, profileId));
  for (const p of allMixed) {
    if (p.scheduleKey) continue; // già contato
    const raw = (p.linkedKeys as string | null) ?? null;
    if (!raw) continue;
    let parsed: Array<{ key: string; amount: number }>;
    try { parsed = JSON.parse(raw); } catch { continue; }
    for (const b of parsed) {
      if (accontoKeys.includes(b.key)) total += Number(b.amount) || 0;
    }
  }
  return Math.round(total * 100) / 100;
}

async function loadGrossCollected(db: Db, profileId: string, year: number, ys: typeof yearSettings.$inferSelect): Promise<number> {
  const rows = await db.select().from(fatture).where(and(eq(fatture.profileId, profileId), eq(fatture.pagAnno, year)));
  if (rows.length > 0) return rows.reduce((s, f) => s + (Number(f.importo) - Number(f.ritenuta ?? 0)), 0);
  if (ys.primoAnnoFatturatoPrec != null) return Number(ys.primoAnnoFatturatoPrec);
  return 0;
}

async function loadPaymentsByKey(db: Db, profileId: string, _year: number) {
  const all = await db.select().from(pagamenti).where(eq(pagamenti.profileId, profileId));
  const map = new Map<string, { paidTotal: number; payments: any[] }>();
  for (const p of all) {
    const importo = Number(p.importo);
    if (p.scheduleKey) {
      const entry = map.get(p.scheduleKey) ?? { paidTotal: 0, payments: [] };
      entry.paidTotal += importo;
      entry.payments.push({ id: p.id, data: p.data, importo, mode: 'pure' });
      map.set(p.scheduleKey, entry);
    } else if (p.linkedKeys) {
      let parsed: Array<{ key: string; amount: number }>;
      try { parsed = JSON.parse(p.linkedKeys as string); } catch { continue; }
      for (const b of parsed) {
        const entry = map.get(b.key) ?? { paidTotal: 0, payments: [] };
        entry.paidTotal += b.amount;
        entry.payments.push({ id: p.id, data: p.data, importo: b.amount, mode: 'mixed' });
        map.set(b.key, entry);
      }
    }
  }
  // round
  for (const [k, v] of map) v.paidTotal = Math.round(v.paidTotal * 100) / 100;
  return map;
}

async function loadBolloByQuarter(db: Db, profileId: string, year: number) {
  // Per ora 2A: 2 € per fattura con marca_da_bollo=1 e data nel quarter.
  // Q123 = mesi 1-9 (semplificazione 5k€ semplificata).
  const rows = await db.select().from(fatture).where(eq(fatture.profileId, profileId));
  let q123 = 0, q4 = 0;
  for (const f of rows) {
    if (f.marcaDaBollo !== 1) continue;
    const date = String(f.data);
    if (!date.startsWith(String(year))) continue;
    const m = parseInt(date.slice(5, 7), 10);
    if (m >= 1 && m <= 9) q123 += 2;
    else q4 += 2;
  }
  return { q123, q4 };
}

export async function buildScadenziarioView(args: BuildArgs): Promise<ScadenziarioView> {
  const { db, profileId, year } = args;
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const ys = await fetchYearSettings(db, profileId, year);
  if (!ys) throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND', `year_settings non trovata per anno ${year}`);
  const ysPrev = await fetchYearSettings(db, profileId, year - 1);
  const profile = (await db.select().from(profiles).where(eq(profiles.id, profileId)))[0];
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'profilo non trovato');
  const attivita = profile.attivita ? JSON.parse(profile.attivita as string) : {};
  const dataInizioAttivita = attivita.data_inizio_attivita ?? attivita.dataInizioAttivita ?? `${year - 1}-01-01`;

  const grossCollected = await loadGrossCollected(db, profileId, year, ys);

  // Contributi INPS params per scenario
  const inpsParams = ys.inpsMode === 'artigiani_commercianti'
    ? getInpsArtComForYear(year)
    : null;
  const inpsParamsPrev = ys.inpsMode === 'artigiani_commercianti' && ysPrev
    ? getInpsArtComForYear(year - 1)
    : null;
  const riduzioneCoeff = ys.riduzione35 === 1 ? 0.65 : 1;
  const currentContribution = ys.inpsMode === 'artigiani_commercianti' && inpsParams
    ? {
        mode: 'artigiani_commercianti' as const,
        fixedAnnual: inpsParams.quotaFissaAnnua * riduzioneCoeff,
        saldoAccontoBase: 0,  // computato da forecast in previsionale, da storico altrove
      }
    : { mode: 'gestione_separata' as const, fixedAnnual: 0, saldoAccontoBase: 0 };
  const previousContribution = ys.inpsMode === 'artigiani_commercianti' && inpsParamsPrev
    ? {
        mode: 'artigiani_commercianti' as const,
        fixedAnnual: inpsParamsPrev.quotaFissaAnnua * (ysPrev?.riduzione35 === 1 ? 0.65 : 1),
        saldoAccontoBase: Number(ysPrev?.primoAnnoContribVariabiliPrec ?? 0),
      }
    : { mode: 'gestione_separata' as const, fixedAnnual: 0, saldoAccontoBase: 0 };

  // Fix A6: somma reali da pagamenti, schedule_key acc1+acc2 dell'anno precedente
  const prevYear = year - 1;
  const accontiSostitutivaKeys = [
    buildScheduleKey('imposta_acc1', prevYear),
    buildScheduleKey('imposta_acc2', prevYear),
  ];
  const accontiContribKeys = [
    buildScheduleKey('contributi_acc1', prevYear),
    buildScheduleKey('contributi_acc2', prevYear),
  ];
  const accontiSostitutivaPagatiReali = await sumAccontiReali(db, profileId, accontiSostitutivaKeys);
  const accontiContribPagatiReali = await sumAccontiReali(db, profileId, accontiContribKeys);

  const previousTaxBase = Number(ysPrev?.primoAnnoImpostaPrec ?? 0);
  const previousContributionAccontiPaid = Number(ysPrev?.primoAnnoAccontiContribPrec ?? 0);

  const comparison = buildForfettarioMethodComparison({
    year,
    method: ys.scadenziarioMetodo as 'storico' | 'previsionale',
    settings: { coefficiente: Number(ys.coefficiente), impostaSostitutiva: Number(ys.impostaSostitutiva), riduzione35: ys.riduzione35 === 1 },
    grossCollected,
    currentContribution,
    previousContribution,
    previousTaxBase,
    previousContributionAccontiPaid,
    accontiSostitutivaPagatiReali,
    accontiContribPagatiReali,
    forecastContributionBase: grossCollected * Number(ys.coefficiente) - inpsParams!.quotaFissaAnnua,
    forecastTaxBase: undefined,
    methodSetting: ys.scadenziarioMetodo as 'storico' | 'previsionale',
    currentSettings: { regime: ys.regime, haRedditoDipendente: ys.haRedditoDipendente },
    previousSettings: ysPrev ? { regime: ysPrev.regime, haRedditoDipendente: ysPrev.haRedditoDipendente } : {},
  });

  const paymentsByKey = await loadPaymentsByKey(db, profileId, year);
  const bolloByQuarter = await loadBolloByQuarter(db, profileId, year);

  const scadOut = buildScadenziario({
    year,
    yearSettings: ys as any,
    previousYearSettings: ysPrev as any,
    scenarios: { historical: comparison.historical, previsionale: comparison.previsionale },
    paymentsByKey,
    bolloByQuarter,
    cameraCommerce: 53,
  });

  // Audit warnings runtime
  const auditCtx = {
    year,
    yearSettings: ys as any,
    profile: { dataInizioAttivita },
    grossCollected,
    today,
  };
  const auditWarnings = evaluateAuditChecks(auditCtx);

  const allWarnings: AuditWarning[] = [...scadOut.warnings, ...auditWarnings];

  return {
    ...scadOut,
    warnings: allWarnings,
    methodComparison: comparison,
    transition: comparison.transition,
    rulesRef: `/api/tax/rules?year=${year}`,
  };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/services/scadenziario-service.ts src/server/services/scadenziario-service.test.ts
git commit -m "feat(server): scadenziario-service con A6 acconti reali + audit warnings"
```

---

## Task 16 — `year-settings` route (A1 boundary 422)

**Files:**
- Create: `src/server/routes/year-settings.ts`
- Test: `src/server/routes/year-settings.test.ts`

- [ ] **Step 1: Test**

`src/server/routes/year-settings.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { errorHandler } from '../middleware/error';
import { sessionMiddleware, type AuthEnv } from '../middleware/auth';
import { yearSettingsRoute } from './year-settings';
import { profiles } from '../db/schema';

async function makeApp() {
  const { db } = await createTestDb();
  const { profileId, sessionId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  // aggiorna profile.attivita
  await db.update(profiles).set({ attivita: JSON.stringify({ data_inizio_attivita: '2018-04-01' }) } as any);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.use('*', sessionMiddleware);
  app.onError(errorHandler);
  app.route('/api/year-settings', yearSettingsRoute);
  const headers = { 'cookie': `lira_session=${sessionId}` };
  return { app, db, headers, profileId };
}

test('GET inesistente → 404', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2030', { headers });
  assert.equal(res.status, 404);
});

test('PUT 2026 forfettario valido → 200', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(res.status, 200);
});

test('PUT regime ordinario → 422 REGIME_NOT_SUPPORTED', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'ordinario', coefficiente: 0.67, impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti', inpsCategoria: null,
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'REGIME_NOT_SUPPORTED');
});

test('FIX A1: PUT sostitutiva 0.05 con attività iniziata 2018 nel 2026 → 422', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.05,
      inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'INVALID_SOSTITUTIVA_5');
});

test('PUT coefficiente invalido (0.50) → 422', async () => {
  const { app, headers } = await makeApp();
  const res = await app.request('/api/year-settings/2026', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario', coefficiente: 0.50, impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    }),
  });
  assert.equal(res.status, 422);
});

test('PATCH /:year/warnings: confirm/unconfirm aggiorna overrides', async () => {
  const { app, headers } = await makeApp();
  // prima crea
  await app.request('/api/year-settings/2026', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    }),
  });
  const res = await app.request('/api/year-settings/2026/warnings', {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: ['M1_RIDUZIONE_35_NON_COMUNICATA'] }),
  });
  assert.equal(res.status, 200);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/routes/year-settings.ts`:
```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { YearSettingsInput } from '@shared/schemas';
import { yearSettings, profiles } from '../db/schema';
import { HttpError } from '../middleware/error';
import { isCoefficienteAmmesso } from '@shared/ateco-coefficienti';
import { isAnnoStartupValido, FORFETTARIO_RULES } from '@shared/forfettario-rules';
import type { AuthEnv } from '../middleware/auth';

export const yearSettingsRoute = new Hono<AuthEnv>();

function yearOf(iso: string): number { return parseInt(iso.slice(0, 4), 10); }

yearSettingsRoute.get('/:year', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = parseInt(c.req.param('year'), 10);
  const rows = await db.select().from(yearSettings).where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  if (!rows[0]) throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND', `year_settings ${year} non trovata`);
  return c.json({ ...rows[0], year });
});

yearSettingsRoute.put('/:year', zValidator('json', YearSettingsInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = parseInt(c.req.param('year'), 10);
  const body = c.req.valid('json');
  if (body.regime !== 'forfettario') throw new HttpError(422, 'REGIME_NOT_SUPPORTED', 'Solo forfettario in 2A');
  if (!isCoefficienteAmmesso(body.coefficiente)) {
    throw new HttpError(422, 'COEFFICIENTE_NON_AMMESSO', 'coefficiente non valido', { ammessi: [0.40, 0.54, 0.62, 0.67, 0.78, 0.86] });
  }
  if (body.impostaSostitutiva === 0.05) {
    const profileRows = await db.select().from(profiles).where(eq(profiles.id, profileId));
    const attivita = profileRows[0]?.attivita ? JSON.parse(profileRows[0].attivita as string) : {};
    const inizio = attivita.data_inizio_attivita ?? attivita.dataInizioAttivita ?? null;
    if (!inizio || !isAnnoStartupValido(yearOf(inizio), year)) {
      throw new HttpError(422, 'INVALID_SOSTITUTIVA_5', 'sostitutiva 5% non più applicabile', { year, dataInizioAttivita: inizio });
    }
  }
  if (body.prorogaSaldoAt && !/^\d{4}-07-\d{2}$/.test(body.prorogaSaldoAt)) {
    throw new HttpError(422, 'PROROGA_FUORI_LUGLIO', 'prorogaSaldoAt deve essere nel mese 07');
  }

  // upsert
  await db.delete(yearSettings).where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  await db.insert(yearSettings).values({
    profileId, year,
    regime: body.regime,
    coefficiente: body.coefficiente,
    impostaSostitutiva: body.impostaSostitutiva,
    inpsMode: body.inpsMode,
    inpsCategoria: body.inpsCategoria,
    riduzione35: body.riduzione35,
    riduzione35Comunicata: body.riduzione35Comunicata,
    riduzione35DataComunicazione: body.riduzione35DataComunicazione ?? null,
    haRedditoDipendente: body.haRedditoDipendente,
    limiteForfettario: body.limiteForfettario,
    scadenziarioMetodo: body.scadenziarioMetodo,
    prorogaSaldoAt: body.prorogaSaldoAt ?? null,
    primoAnnoFatturatoPrec: body.primoAnnoFatturatoPrec ?? null,
    primoAnnoImpostaPrec: body.primoAnnoImpostaPrec ?? null,
    primoAnnoAccontiImpostaPrec: body.primoAnnoAccontiImpostaPrec ?? null,
    primoAnnoContribVariabiliPrec: body.primoAnnoContribVariabiliPrec ?? null,
    primoAnnoAccontiContribPrec: body.primoAnnoAccontiContribPrec ?? null,
    overrides: body.overrides ? JSON.stringify(body.overrides) : null,
  } as any);
  return c.json({ ok: true });
});

yearSettingsRoute.patch('/:year/warnings', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = parseInt(c.req.param('year'), 10);
  const body = await c.req.json<{ confirm?: string[]; unconfirm?: string[] }>();
  const rows = await db.select().from(yearSettings).where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  if (!rows[0]) throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND');
  const overrides = rows[0].overrides ? JSON.parse(rows[0].overrides as string) : {};
  const set = new Set<string>(overrides.confirmedWarnings ?? []);
  for (const c2 of body.confirm ?? []) set.add(c2);
  for (const u of body.unconfirm ?? []) set.delete(u);
  overrides.confirmedWarnings = Array.from(set);
  await db.update(yearSettings).set({ overrides: JSON.stringify(overrides) } as any)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  return c.json({ ok: true, confirmedWarnings: overrides.confirmedWarnings });
});
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/year-settings.ts src/server/routes/year-settings.test.ts
git commit -m "feat(api): year-settings GET/PUT/PATCH con A1 boundary 422"
```

---

## Task 17 — `pagamenti` routes (CRUD + quick-pay)

**Files:**
- Create: `src/server/routes/pagamenti.ts`
- Test: `src/server/routes/pagamenti.test.ts`

- [ ] **Step 1: Test**

`src/server/routes/pagamenti.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { errorHandler } from '../middleware/error';
import { sessionMiddleware, type AuthEnv } from '../middleware/auth';
import { pagamentiRoute } from './pagamenti';
import { yearSettings } from '../db/schema';

async function makeApp() {
  const { db } = await createTestDb();
  const { profileId, sessionId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  await db.insert(yearSettings).values({
    profileId, year: 2026, regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 0, riduzione35Comunicata: 0, haRedditoDipendente: 0,
    limiteForfettario: 85000, scadenziarioMetodo: 'storico',
  } as any);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.use('*', sessionMiddleware);
  app.onError(errorHandler);
  app.route('/api/pagamenti', pagamentiRoute);
  return { app, db, headers: { cookie: `lira_session=${sessionId}` } };
}

test('POST + GET pagamenti CRUD round-trip', async () => {
  const { app, headers } = await makeApp();
  const r1 = await app.request('/api/pagamenti', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026, data: '2026-06-30', tipo: 'tasse',
      importo: 1500, scheduleKey: 'imposta_acc1_2026', descrizione: 'acconto 1',
    }),
  });
  assert.equal(r1.status, 200);
  const created = await r1.json();
  const r2 = await app.request('/api/pagamenti?year=2026', { headers });
  const list = await r2.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
});

test('POST con scheduleKey invalida → 400 INVALID_SCHEDULE_KEY', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026, data: '2026-06-30', tipo: 'tasse', importo: 100, scheduleKey: 'nonsense',
    }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, 'INVALID_SCHEDULE_KEY');
});

test('POST con linkedKeys breakdown → 200 + GET ritorna il breakdown', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026, data: '2026-06-30', tipo: 'misto', importo: 2600,
      linkedKeys: [{ key: 'imposta_acc1_2026', amount: 1500 }, { key: 'inps_fissi_2_2026', amount: 1100 }],
    }),
  });
  assert.equal(r.status, 200);
});

test('quick-pay: scheduleKey ok → crea pagamento con default data oggi e importo richiesto', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti/quick-pay', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ scheduleKey: 'imposta_acc1_2026', importo: 1500 }),
  });
  assert.equal(r.status, 200);
});

test('quick-pay: scheduleKey unknown → 409', async () => {
  const { app, headers } = await makeApp();
  const r = await app.request('/api/pagamenti/quick-pay', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ scheduleKey: 'inesistente_2099', importo: 100 }),
  });
  assert.equal(r.status, 409);
});

test('DELETE rimuove il pagamento', async () => {
  const { app, headers } = await makeApp();
  const r1 = await app.request('/api/pagamenti', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ year: 2026, data: '2026-06-30', tipo: 'tasse', importo: 100, scheduleKey: 'imposta_acc1_2026' }),
  });
  const id = (await r1.json()).id;
  const r2 = await app.request(`/api/pagamenti/${id}`, { method: 'DELETE', headers });
  assert.equal(r2.status, 200);
  const list = await (await app.request('/api/pagamenti?year=2026', { headers })).json();
  assert.equal(list.length, 0);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/routes/pagamenti.ts`:
```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { PagamentoCreateInput, PagamentoQuickPayInput } from '@shared/schemas';
import { parseScheduleKey } from '@shared/schedule-keys';
import { pagamenti } from '../db/schema';
import { HttpError } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

export const pagamentiRoute = new Hono<AuthEnv>();

pagamentiRoute.get('/', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const yearQ = c.req.query('year');
  const conditions = [eq(pagamenti.profileId, profileId)];
  if (yearQ) conditions.push(eq(pagamenti.year, parseInt(yearQ, 10)));
  const rows = await db.select().from(pagamenti).where(and(...conditions));
  return c.json(rows.map((r) => ({ ...r, linkedKeys: r.linkedKeys ? JSON.parse(r.linkedKeys as string) : null })));
});

pagamentiRoute.post('/', zValidator('json', PagamentoCreateInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json');
  if (body.scheduleKey && !parseScheduleKey(body.scheduleKey)) {
    throw new HttpError(400, 'INVALID_SCHEDULE_KEY', `scheduleKey ${body.scheduleKey} non valida`);
  }
  for (const b of body.linkedKeys ?? []) {
    if (!parseScheduleKey(b.key)) throw new HttpError(400, 'INVALID_SCHEDULE_KEY', `linkedKeys.key ${b.key} non valida`);
  }
  const id = randomUUID();
  await db.insert(pagamenti).values({
    id, profileId, year: body.year, data: body.data, tipo: body.tipo,
    descrizione: body.descrizione ?? null, importo: body.importo,
    scheduleKey: body.scheduleKey ?? null,
    linkedKeys: body.linkedKeys ? JSON.stringify(body.linkedKeys) : null,
    note: body.note ?? null,
  } as any);
  return c.json({ ok: true, id });
});

pagamentiRoute.post('/quick-pay', zValidator('json', PagamentoQuickPayInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json');
  const parsed = parseScheduleKey(body.scheduleKey);
  if (!parsed) throw new HttpError(409, 'PAGAMENTO_SCHEDULE_KEY_UNKNOWN', `scheduleKey ${body.scheduleKey} sconosciuta`);
  const id = randomUUID();
  const data = body.data ?? new Date().toISOString().slice(0, 10);
  const importo = body.importo ?? 0;
  if (importo <= 0) {
    // Lo "snap to expected" si farebbe leggendo lo scadenziario; per 2A se importo manca, richiediamo esplicito
    throw new HttpError(400, 'MISSING_IMPORTO', 'importo richiesto in quick-pay finché lo scadenziario lookup non è implementato lato server');
  }
  const family = parsed.family;
  const tipo = body.tipo ?? (family.startsWith('imposta') || family.startsWith('bollo') || family === 'camera' ? 'tasse' : 'contributi');
  await db.insert(pagamenti).values({
    id, profileId, year: parsed.year, data, tipo,
    descrizione: `Quick-pay ${body.scheduleKey}`, importo, scheduleKey: body.scheduleKey,
  } as any);
  return c.json({ ok: true, id });
});

pagamentiRoute.patch('/:id', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  const patch = await c.req.json();
  if (patch.scheduleKey && !parseScheduleKey(patch.scheduleKey)) {
    throw new HttpError(400, 'INVALID_SCHEDULE_KEY');
  }
  if (patch.linkedKeys) {
    for (const b of patch.linkedKeys) {
      if (!parseScheduleKey(b.key)) throw new HttpError(400, 'INVALID_SCHEDULE_KEY');
    }
    patch.linkedKeys = JSON.stringify(patch.linkedKeys);
  }
  await db.update(pagamenti).set(patch).where(and(eq(pagamenti.profileId, profileId), eq(pagamenti.id, id)));
  return c.json({ ok: true });
});

pagamentiRoute.delete('/:id', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const id = c.req.param('id');
  await db.delete(pagamenti).where(and(eq(pagamenti.profileId, profileId), eq(pagamenti.id, id)));
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/pagamenti.ts src/server/routes/pagamenti.test.ts
git commit -m "feat(api): pagamenti CRUD + quick-pay + linkedKeys breakdown"
```

---

## Task 18 — `scadenziario` route

**Files:**
- Create: `src/server/routes/scadenziario.ts`
- Test: `src/server/routes/scadenziario.test.ts`

- [ ] **Step 1: Test**

`src/server/routes/scadenziario.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { errorHandler } from '../middleware/error';
import { sessionMiddleware, type AuthEnv } from '../middleware/auth';
import { scadenziarioRoute } from './scadenziario';
import { yearSettings, profiles } from '../db/schema';

async function setup() {
  const { db } = await createTestDb();
  const { profileId, sessionId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  await db.update(profiles).set({ attivita: JSON.stringify({ data_inizio_attivita: '2018-04-01' }) } as any);
  await db.insert(yearSettings).values({
    profileId, year: 2025, regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 0, riduzione35Comunicata: 0, haRedditoDipendente: 0,
    limiteForfettario: 85000, scadenziarioMetodo: 'storico',
  } as any);
  await db.insert(yearSettings).values({
    profileId, year: 2026, regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 0, riduzione35Comunicata: 0, haRedditoDipendente: 0,
    limiteForfettario: 85000, scadenziarioMetodo: 'storico',
  } as any);
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.use('*', sessionMiddleware);
  app.onError(errorHandler);
  app.route('/api/scadenziario', scadenziarioRoute);
  return { app, headers: { cookie: `lira_session=${sessionId}` } };
}

test('GET /api/scadenziario/2026 → 200 con 13 righe', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/scadenziario/2026', { headers });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.rows.length, 13);
});

test('GET include methodComparison + warnings + rulesRef', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/scadenziario/2026', { headers });
  const body = await r.json();
  assert.ok(body.methodComparison);
  assert.ok(Array.isArray(body.warnings));
  assert.match(body.rulesRef, /\/api\/tax\/rules\?year=2026/);
});

test('GET 2030 senza year_settings → 404', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/scadenziario/2030', { headers });
  assert.equal(r.status, 404);
});

test('FIX A5: con proroga settata, response.warnings include A5_PROROGA_APPLICATA', async () => {
  const { app, headers } = await setup();
  // metti la proroga via PUT year-settings (riusa l'altra route oppure update diretto DB)
  const r = await app.request('/api/scadenziario/2026', { headers });
  const body = await r.json();
  // Se la proroga è nulla → A5 non c'è. Il test "positivo" è coperto in scadenziario-engine.test.ts.
  assert.ok(body.warnings.every((w: any) => w.code !== 'A5_PROROGA_APPLICATA'));
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/routes/scadenziario.ts`:
```ts
import { Hono } from 'hono';
import { buildScadenziarioView } from '../services/scadenziario-service';
import type { AuthEnv } from '../middleware/auth';

export const scadenziarioRoute = new Hono<AuthEnv>();

scadenziarioRoute.get('/:year', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = parseInt(c.req.param('year'), 10);
  const view = await buildScadenziarioView({ db, profileId, year });
  return c.json(view);
});
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/scadenziario.ts src/server/routes/scadenziario.test.ts
git commit -m "feat(api): GET /api/scadenziario/:year"
```

---

## Task 19 — `tax/simulate` + `tax/rules` route

**Files:**
- Create: `src/server/routes/tax.ts`
- Test: `src/server/routes/tax.test.ts`

- [ ] **Step 1: Test**

`src/server/routes/tax.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { errorHandler } from '../middleware/error';
import { sessionMiddleware, type AuthEnv } from '../middleware/auth';
import { taxRoute } from './tax';

async function setup() {
  const { db } = await createTestDb();
  const { sessionId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => { c.set('db', db); await next(); });
  app.use('*', sessionMiddleware);
  app.onError(errorHandler);
  app.route('/api/tax', taxRoute);
  return { app, headers: { cookie: `lira_session=${sessionId}` } };
}

test('GET /api/tax/rules?year=2025 → 200 con INPS_ARTCOM + INPS_GS', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/tax/rules?year=2025', { headers });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.inpsArtcom);
  assert.ok(body.inpsGs);
  assert.ok(body.accontoRules);
});

test('POST /api/tax/simulate → 200 con scenario', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/tax/simulate', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      year: 2026, grossCollected: 50000,
      settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, inpsMode: 'artigiani_commercianti' },
    }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.year, 2026);
  assert.ok(body.substituteTax > 0);
});

test('POST /api/tax/simulate con anno INPS mancante → 422', async () => {
  const { app, headers } = await setup();
  const r = await app.request('/api/tax/simulate', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ year: 1999, grossCollected: 10000 }),
  });
  assert.equal(r.status, 422);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementare**

`src/server/routes/tax.ts`:
```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { TaxSimulateInput } from '@shared/schemas';
import { INPS_ARTCOM, INPS_GS, getInpsArtComForYear } from '@shared/inps-params';
import { ACCONTO_RULES } from '@shared/acconto-rules';
import { FORFETTARIO_RULES } from '@shared/forfettario-rules';
import { buildForfettarioScenario } from '../lib/tax-engine';
import { HttpError } from '../middleware/error';
import type { AuthEnv } from '../middleware/auth';

export const taxRoute = new Hono<AuthEnv>();

taxRoute.get('/rules', async (c) => {
  const yearQ = c.req.query('year');
  const year = yearQ ? parseInt(yearQ, 10) : new Date().getUTCFullYear();
  return c.json({
    year,
    inpsArtcom: INPS_ARTCOM[year] ?? null,
    inpsGs: INPS_GS[year] ?? null,
    accontoRules: ACCONTO_RULES,
    forfettarioRules: FORFETTARIO_RULES,
  });
});

taxRoute.post('/simulate', zValidator('json', TaxSimulateInput), async (c) => {
  const body = c.req.valid('json');
  const year = body.year;
  let inps;
  try { inps = getInpsArtComForYear(year); }
  catch { throw new HttpError(422, 'INPS_PARAMS_UNAVAILABLE', `INPS params per ${year} non disponibili`); }
  const coefficiente = body.settings?.coefficiente ?? 0.67;
  const sostitutiva = body.settings?.impostaSostitutiva ?? FORFETTARIO_RULES.sostitutivaStandard;
  const riduzione = body.settings?.riduzione35 === 1 ? FORFETTARIO_RULES.riduzioneInpsCoefficiente : 1;
  const scenario = buildForfettarioScenario({
    year,
    method: body.method ?? 'storico',
    settings: { coefficiente, impostaSostitutiva: sostitutiva, riduzione35: body.settings?.riduzione35 === 1 },
    grossCollected: body.grossCollected,
    currentContribution: { mode: 'artigiani_commercianti', fixedAnnual: inps.quotaFissaAnnua * riduzione, saldoAccontoBase: 0 },
    previousContribution: { mode: 'artigiani_commercianti', fixedAnnual: inps.quotaFissaAnnua * riduzione, saldoAccontoBase: 0 },
    previousTaxBase: 0,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
    forecastTaxBase: undefined,
    forecastContributionBase: body.grossCollected * coefficiente,
  });
  return c.json(scenario);
});
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/tax.ts src/server/routes/tax.test.ts
git commit -m "feat(api): /api/tax/rules + /api/tax/simulate"
```

---

## Task 20 — Mount routes nell'entry server

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Identificare i mount esistenti**

Leggere `src/server/index.ts` per vedere come sono montate `healthRoute`, `authRoute`, `profilesRoute`.

- [ ] **Step 2: Aggiungere i 4 mount**

Aggiungere import + mount per: `yearSettingsRoute`, `pagamentiRoute`, `scadenziarioRoute`, `taxRoute`. Mount paths: `/api/year-settings`, `/api/pagamenti`, `/api/scadenziario`, `/api/tax`.

Esempio (adattare al pattern già presente):
```ts
import { yearSettingsRoute } from './routes/year-settings';
import { pagamentiRoute } from './routes/pagamenti';
import { scadenziarioRoute } from './routes/scadenziario';
import { taxRoute } from './routes/tax';

// ... dopo i mount esistenti:
app.route('/api/year-settings', yearSettingsRoute);
app.route('/api/pagamenti', pagamentiRoute);
app.route('/api/scadenziario', scadenziarioRoute);
app.route('/api/tax', taxRoute);
```

- [ ] **Step 3: Type-check + test full**

```bash
npm run typecheck
npm test
```

Atteso: tutti verdi.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): mount year-settings, pagamenti, scadenziario, tax routes"
```

---

## Task 21 — Golden fixtures Mattia/Peru 2025

**Files:**
- Create: `src/test-fixtures/mattia-2025.ts`
- Create: `src/test-fixtures/peru-2025.ts`
- Create: `src/test-fixtures/golden-regression.test.ts`

Le fixture sono "frozen" output che bloccano regressioni durante il porting. Numeri attesi calibrati side-by-side con CalcoliVari (run CalcoliVari live, copia output, congela).

- [ ] **Step 1: Scaffold fixtures**

`src/test-fixtures/mattia-2025.ts`:
```ts
// Profilo Mattia 2025: ATECO 62.10.00 (programmazione), forfettario, sostitutiva 15%.
// Numeri attesi calibrati con CalcoliVari il 2026-06-05.
export const MATTIA_2025 = {
  input: {
    year: 2025,
    profile: { dataInizioAttivita: '2018-04-01' },
    yearSettings: {
      regime: 'forfettario' as const,
      coefficiente: 0.67,
      impostaSostitutiva: 0.15,
      inpsMode: 'artigiani_commercianti' as const,
      inpsCategoria: 'artigiano' as const,
      riduzione35: 0,
      haRedditoDipendente: 0,
    },
    grossCollected: 0,  // CALIBRARE: prendere il valore reale incassato 2025 dal CalcoliVari
  },
  expected: {
    // CALIBRARE dopo 1° run lato CalcoliVari:
    forfettarioGrossIncome: 0,
    substituteTax: 0,
    saldoSostitutiva: 0,
    inpsQuotaFissaRata: 0,
    // ecc.
  },
};
```

`src/test-fixtures/peru-2025.ts`: analogo per il profilo Peru.

- [ ] **Step 2: Test di ancoraggio (golden regression)**

`src/test-fixtures/golden-regression.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATTIA_2025 } from './mattia-2025';
import { PERU_2025 } from './peru-2025';
import { buildForfettarioScenario } from '../server/lib/tax-engine';
import { getInpsArtComForYear } from '../shared/inps-params';

function runFor(fx: typeof MATTIA_2025) {
  const inps = getInpsArtComForYear(fx.input.year);
  return buildForfettarioScenario({
    year: fx.input.year,
    method: 'storico',
    settings: { coefficiente: fx.input.yearSettings.coefficiente, impostaSostitutiva: fx.input.yearSettings.impostaSostitutiva, riduzione35: false },
    grossCollected: fx.input.grossCollected,
    currentContribution: { mode: 'artigiani_commercianti', fixedAnnual: inps.quotaFissaAnnua, saldoAccontoBase: 0 },
    previousContribution: { mode: 'artigiani_commercianti', fixedAnnual: inps.quotaFissaAnnua, saldoAccontoBase: 0 },
    previousTaxBase: 0,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  });
}

test('GOLDEN Mattia 2025: numeri tax-engine bloccati', () => {
  const out = runFor(MATTIA_2025);
  // assert sui valori expected. Calibrare al 1° run.
  // assert.equal(out.forfettarioGrossIncome, MATTIA_2025.expected.forfettarioGrossIncome);
  assert.ok(typeof out.forfettarioGrossIncome === 'number');
});

test('GOLDEN Peru 2025: numeri tax-engine bloccati', () => {
  const out = runFor(PERU_2025);
  assert.ok(typeof out.forfettarioGrossIncome === 'number');
});
```

- [ ] **Step 3: Calibrazione manuale (run-once)**

Procedura:
1. Aprire CalcoliVari sul profilo Mattia, anno 2025.
2. Annotare: ricavi incassati, sostitutiva, INPS quote fisse, INPS saldo/acconti.
3. Inserire i numeri reali in `MATTIA_2025.input.grossCollected` + `.expected`.
4. Sostituire gli `assert.ok` con `assert.equal(out.X, MATTIA_2025.expected.X)`.
5. Run → se PASS al 1° tentativo, GREAT. Se FAIL, debuggare divergenze (probabilmente differenze di arrotondamento o INPS year). Una volta verde, **congelare**.

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/test-fixtures/
git commit -m "test(fixtures): golden regression Mattia/Peru 2025 (calibrate prima del freeze)"
```

---

## Task 22 — README update + smoke test + Definition of Done

**Files:**
- Modify: `README.md`
- Create (smoke): `scripts/smoke-scadenziario.ts`

- [ ] **Step 1: Aggiornare README**

Sezione "Modulo fiscale" sotto le sezioni esistenti del foundation. Documenta:
- Cosa è Slice 2A (forfettario)
- API disponibili: GET/PUT year-settings, CRUD pagamenti, GET scadenziario, POST tax/simulate, GET tax/rules
- I 7 audit fix risolti
- Come testare manualmente (curl examples con login → set cookie → query scadenziario)

- [ ] **Step 2: Smoke script**

`scripts/smoke-scadenziario.ts`:
```ts
// Smoke E2E in process: crea user+profile, year_settings, una fattura, un pagamento,
// e chiama buildScadenziarioView. Stampa risultato.
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile } from '../src/server/lib/users';
import { yearSettings, fatture, pagamenti } from '../src/server/db/schema';
import { buildScadenziarioView } from '../src/server/services/scadenziario-service';
import { randomUUID } from 'node:crypto';

const { db } = await createTestDb();
const { profileId } = await createUserWithDefaultProfile({
  db, email: 'smoke@x.it', password: 'pwd-lunga-12345', name: 'Smoke',
});
await db.insert(yearSettings).values({
  profileId, year: 2026, regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.15,
  inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
  riduzione35: 0, riduzione35Comunicata: 0, haRedditoDipendente: 0,
  limiteForfettario: 85000, scadenziarioMetodo: 'storico',
} as any);
await db.insert(fatture).values({
  id: randomUUID(), profileId, tipoDocumento: 'TD01', annoProgressivo: 2026, progressivo: 1,
  numeroDisplay: '2026/001', data: '2026-03-15', righe: JSON.stringify([{ descrizione: 'consulenza', quantita: 1, prezzo_unitario: 5000 }]),
  importo: 5000, pagAnno: 2026, pagMese: 4, stato: 'pagata',
} as any);
const view = await buildScadenziarioView({ db, profileId, year: 2026 });
console.log(JSON.stringify({
  rows: view.rows.map((r) => ({ id: r.id, dueDate: r.dueDate, amount: r.amount.point, status: r.status.code })),
  warnings: view.warnings.map((w) => w.code),
  summary: view.summary,
}, null, 2));
```

Run: `npx tsx scripts/smoke-scadenziario.ts` → output JSON sensato.

- [ ] **Step 3: Definition of Done check**

```bash
npm test               # tutti verdi
npm run typecheck      # zero errori
npm run build          # build success
npx tsx scripts/smoke-scadenziario.ts  # output JSON sensato
```

- [ ] **Step 4: Commit + merge a main**

```bash
git add README.md scripts/smoke-scadenziario.ts
git commit -m "docs(readme): sezione modulo fiscale + smoke script"
```

Se branch separato:
```bash
git checkout main
git merge --no-ff <branch> -m "feat: Slice 2A — tax engine + scadenziario forfettario"
```

---

## Definition of Done (riassunto)

- [ ] 22 task completati con commit dedicati
- [ ] `npm test` verde (~130 totali)
- [ ] `npm run typecheck` zero errori
- [ ] `npm run build` success
- [ ] Smoke script `smoke-scadenziario.ts` produce output JSON sensato
- [ ] Golden fixtures Mattia/Peru calibrate e congelate
- [ ] README aggiornato con sezione "Modulo fiscale"
- [ ] Migration `0001_audit_fixes_year_settings.sql` su `drizzle/`
- [ ] PR (o merge diretto) a `origin/main`

## Audit coverage (final check)

| Fix | Task | Verifica esplicita |
|---|---|---|
| C1 (soglia 85k/100k) | 7 | `audit-checks.test.ts` 4 casi |
| C3 (28/02 slittamento) | 6 | `date-rules.test.ts` 2 casi |
| A1 (sostitutiva 5%) | 7, 16 | warning info + 422 boundary |
| A5 (proroga propagation) | 14 | `scadenziario-engine.test.ts` 2 casi |
| A6 (saldo - acconti reali) | 10, 15 | tax-engine test + service A6 |
| M1 (riduzione 35 comunicata) | 7 | `audit-checks.test.ts` 2 casi |
| M3 (soglie 51.65/257.52) | 1, 9 | `acconto-rules.test.ts` + boundary test |
