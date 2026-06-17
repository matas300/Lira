# Slice 1 — Menu profilo + Impostazioni + Tema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un menu profilo nel footer della sidebar (Riepilogo / Profilo personale / Profilo P.IVA / Impostazioni / Tema / Logout) con la pagina `/impostazioni` (editor dei parametri fiscali per-anno) e il toggle tema dark/light; le 3 voci pesanti puntano a placeholder.

**Architecture:** Frontend-only (backend `GET/PUT /api/year-settings/:year` già esiste con boundary check). Logica pura testabile in `lib/year-settings-form.ts` (defaults, mapping stato↔body, opzioni ATECO) e `lib/theme.ts` (tema, storage iniettabile). Pagina `pages/impostazioni.ts` (render puri + mount fetch/save). Menu profilo dentro `components/sidebar.ts` (popup con wiring open/close). Le CTA `needsConfig` puntano a `/impostazioni`.

**Tech Stack:** TypeScript strict (noUncheckedIndexedAccess), Vite vanilla DOM, Hono+Drizzle (solo lato consumo API), Node `--test`.

---

## File Structure

- Modify: `src/shared/ateco-coefficienti.ts` — esporta i gruppi ATECO per la UI.
- Create: `src/client/lib/theme.ts` — gestione tema (dark/light), storage iniettabile.
- Test: `src/client/lib/theme.test.ts`.
- Create: `src/client/lib/year-settings-form.ts` — logica pura del form (defaults, stateFromResponse, bodyFromState, opzioni ATECO).
- Test: `src/client/lib/year-settings-form.test.ts`.
- Create: `src/client/pages/impostazioni.ts` — render puri + mount.
- Test: `src/client/pages/impostazioni.test.ts`.
- Modify: `src/client/components/sidebar.ts` — footer con menu profilo popup + wiring.
- Modify: `src/client/components/sidebar.test.ts` — copertura menu.
- Modify: `src/client/lib/nav.ts` — etichette per le route fuori-nav (labelForRoute).
- Modify: `src/client/main.ts` — route `/impostazioni` + placeholder, applica tema al boot.
- Modify: `src/client/pages/regime.ts`, `tasse.ts`, `budget.ts` — CTA needsConfig → `/impostazioni`.
- Modify: `src/client/styles/index.css` — stili menu popup + pagina impostazioni.

---

## Task 1: Esporre i gruppi ATECO per la UI

**Files:**
- Modify: `src/shared/ateco-coefficienti.ts`
- Test: `src/shared/ateco-coefficienti.test.ts` (creare se non esiste; se esiste, aggiungere il test)

- [ ] **Step 1: Scrivere il test**

In `src/shared/ateco-coefficienti.test.ts` (se non esiste, crearlo con header `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { atecoGruppiUI } from './ateco-coefficienti';`):

```ts
test('atecoGruppiUI: ritorna 9 gruppi con label e coefficiente ammesso', () => {
  const g = atecoGruppiUI();
  assert.equal(g.length, 9);
  for (const x of g) {
    assert.equal(typeof x.label, 'string');
    assert.ok([0.40, 0.54, 0.62, 0.67, 0.78, 0.86].includes(x.coefficiente));
  }
  // include il gruppo professionisti 78%
  assert.ok(g.some((x) => x.coefficiente === 0.78));
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/shared/ateco-coefficienti.test.ts`
Expected: FAIL — `atecoGruppiUI` non esiste.

- [ ] **Step 3: Implementare l'export**

In `src/shared/ateco-coefficienti.ts`, dopo la definizione di `GRUPPI_ATECO` (e prima o dopo le funzioni esistenti), aggiungere:

```ts
/**
 * Gruppi ATECO per la UI (label + coefficiente), senza i `ranges` interni.
 * Usato dall'editor parametri per il select del coefficiente.
 */
export function atecoGruppiUI(): ReadonlyArray<{ label: string; coefficiente: CoefficienteAmmesso }> {
  return GRUPPI_ATECO.map((g) => ({ label: g.label, coefficiente: g.coefficiente }));
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/shared/ateco-coefficienti.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ateco-coefficienti.ts src/shared/ateco-coefficienti.test.ts
git commit -m "feat(shared): atecoGruppiUI() per il select coefficiente dell'editor"
```

---

## Task 2: Modulo tema (`lib/theme.ts`)

**Files:**
- Create: `src/client/lib/theme.ts`
- Test: `src/client/lib/theme.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/lib/theme.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTheme, setTheme, toggleTheme } from './theme';

function fakeStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test('getTheme: default dark quando storage vuoto', () => {
  assert.equal(getTheme(fakeStore()), 'dark');
});

test('setTheme/getTheme: persiste light', () => {
  const s = fakeStore();
  setTheme('light', s);
  assert.equal(getTheme(s), 'dark' === 'light' ? 'dark' : 'light'); // light
  assert.equal(getTheme(s), 'light');
});

test('toggleTheme: alterna e ritorna il nuovo valore', () => {
  const s = fakeStore();
  assert.equal(toggleTheme(s), 'light'); // da dark → light
  assert.equal(toggleTheme(s), 'dark');  // da light → dark
});

test('getTheme: valore sporco nello storage → default dark', () => {
  const s = fakeStore();
  s.setItem('lira_theme', 'banana');
  assert.equal(getTheme(s), 'dark');
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/lib/theme.test.ts`
Expected: FAIL — `./theme` non esiste.

- [ ] **Step 3: Implementare**

Create `src/client/lib/theme.ts`:

```ts
// src/client/lib/theme.ts
// Tema dark/light: UI-state (ammesso da CLAUDE.md), MAI dati di dominio.
// Storage iniettabile per i test; applica via document.documentElement.dataset.theme.
// I token light vivono in styles/tokens.css (html[data-theme="light"]).

export type Theme = 'dark' | 'light';
const KEY = 'lira_theme';

interface SimpleStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; }
function store(s?: SimpleStorage): SimpleStorage {
  return s ?? (globalThis as unknown as { localStorage: SimpleStorage }).localStorage;
}

export function getTheme(s?: SimpleStorage): Theme {
  return store(s).getItem(KEY) === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme, s?: SimpleStorage): void {
  store(s).setItem(KEY, theme);
}

export function toggleTheme(s?: SimpleStorage): Theme {
  const next: Theme = getTheme(s) === 'dark' ? 'light' : 'dark';
  setTheme(next, s);
  return next;
}

/** Applica il tema corrente al documento (no-op se non c'è document, es. test). */
export function applyTheme(s?: SimpleStorage): void {
  const doc = (globalThis as unknown as { document?: { documentElement: { dataset: Record<string, string> } } }).document;
  if (doc) doc.documentElement.dataset['theme'] = getTheme(s);
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/lib/theme.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/theme.ts src/client/lib/theme.test.ts
git commit -m "feat(client): modulo tema dark/light (lib/theme.ts)"
```

---

## Task 3: Logica pura del form (`lib/year-settings-form.ts`)

**Files:**
- Create: `src/client/lib/year-settings-form.ts`
- Test: `src/client/lib/year-settings-form.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/lib/year-settings-form.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, stateFromResponse, bodyFromState, atecoOptions, selectedAtecoIndex } from './year-settings-form';

test('defaults: forfettario, 78%, 15%, gestione separata, limite 85000', () => {
  const d = defaults();
  assert.equal(d.regime, 'forfettario');
  assert.equal(d.coefficiente, 0.78);
  assert.equal(d.impostaSostitutiva, 0.15);
  assert.equal(d.inpsMode, 'gestione_separata');
  assert.equal(d.inpsCategoria, null);
  assert.equal(d.limiteForfettario, 85000);
  assert.equal(d.scadenziarioMetodo, 'storico');
  assert.equal(d.riduzione35, false);
});

test('stateFromResponse: converte i flag 0/1 del server in boolean', () => {
  const s = stateFromResponse({
    regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.05,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 1, riduzione35Comunicata: 1, riduzione35DataComunicazione: '2026-02-20',
    haRedditoDipendente: 0, limiteForfettario: 85000, scadenziarioMetodo: 'previsionale',
    prorogaSaldoAt: null, tariffaGiornaliera: 250,
    primoAnnoFatturatoPrec: null, primoAnnoImpostaPrec: null, primoAnnoAccontiImpostaPrec: null,
    primoAnnoContribVariabiliPrec: null, primoAnnoAccontiContribPrec: null,
  });
  assert.equal(s.riduzione35, true);
  assert.equal(s.riduzione35Comunicata, true);
  assert.equal(s.haRedditoDipendente, false);
  assert.equal(s.inpsCategoria, 'artigiano');
  assert.equal(s.tariffaGiornaliera, 250);
});

test('bodyFromState: boolean → 0/1; inpsCategoria null se gestione separata', () => {
  const s = { ...defaults(), inpsMode: 'gestione_separata' as const, inpsCategoria: 'artigiano' as const, haRedditoDipendente: true };
  const b = bodyFromState(s);
  assert.equal(b.haRedditoDipendente, 1);
  assert.equal(b.inpsCategoria, null); // azzerata perché gestione separata
  assert.equal(b.regime, 'forfettario');
});

test('bodyFromState: riduzione disattiva → comunicata 0 e data null', () => {
  const s = { ...defaults(), riduzione35: false, riduzione35Comunicata: true, riduzione35DataComunicazione: '2026-02-01' };
  const b = bodyFromState(s);
  assert.equal(b.riduzione35, 0);
  assert.equal(b.riduzione35Comunicata, 0);
  assert.equal(b.riduzione35DataComunicazione, null);
});

test('atecoOptions / selectedAtecoIndex: pre-seleziona il primo gruppo col coefficiente dato', () => {
  const opts = atecoOptions();
  assert.ok(opts.length >= 6);
  const idx = selectedAtecoIndex(0.78, opts);
  assert.ok(idx >= 0);
  assert.equal(opts[idx]!.coefficiente, 0.78);
  // coefficiente non presente → -1
  assert.equal(selectedAtecoIndex(0.99, opts), -1);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/lib/year-settings-form.test.ts`
Expected: FAIL — `./year-settings-form` non esiste.

- [ ] **Step 3: Implementare**

Create `src/client/lib/year-settings-form.ts`:

```ts
// src/client/lib/year-settings-form.ts
// Logica pura dell'editor parametri (year_settings): defaults, mapping
// stato↔body API, opzioni ATECO. Nessun DOM, nessun fetch.

import { atecoGruppiUI } from '@shared/ateco-coefficienti';

export type Regime = 'forfettario' | 'ordinario';
export type InpsMode = 'gestione_separata' | 'artigiani_commercianti';
export type InpsCategoria = 'artigiano' | 'commerciante' | null;
export type ScadenziarioMetodo = 'storico' | 'previsionale';

export interface YsFormState {
  regime: Regime;
  coefficiente: number;
  impostaSostitutiva: number; // 0.15 | 0.05
  inpsMode: InpsMode;
  inpsCategoria: InpsCategoria;
  riduzione35: boolean;
  riduzione35Comunicata: boolean;
  riduzione35DataComunicazione: string | null;
  haRedditoDipendente: boolean;
  limiteForfettario: number;
  scadenziarioMetodo: ScadenziarioMetodo;
  prorogaSaldoAt: string | null;
  primoAnnoFatturatoPrec: number | null;
  primoAnnoImpostaPrec: number | null;
  primoAnnoAccontiImpostaPrec: number | null;
  primoAnnoContribVariabiliPrec: number | null;
  primoAnnoAccontiContribPrec: number | null;
  tariffaGiornaliera: number | null;
}

export function defaults(): YsFormState {
  return {
    regime: 'forfettario',
    coefficiente: 0.78,
    impostaSostitutiva: 0.15,
    inpsMode: 'gestione_separata',
    inpsCategoria: null,
    riduzione35: false,
    riduzione35Comunicata: false,
    riduzione35DataComunicazione: null,
    haRedditoDipendente: false,
    limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
    prorogaSaldoAt: null,
    primoAnnoFatturatoPrec: null,
    primoAnnoImpostaPrec: null,
    primoAnnoAccontiImpostaPrec: null,
    primoAnnoContribVariabiliPrec: null,
    primoAnnoAccontiContribPrec: null,
    tariffaGiornaliera: null,
  };
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mappa la risposta del server (toPublic, flag 0/1) nello stato del form. */
export function stateFromResponse(ys: Record<string, unknown>): YsFormState {
  const d = defaults();
  return {
    regime: (ys['regime'] as Regime) ?? d.regime,
    coefficiente: num(ys['coefficiente']) ?? d.coefficiente,
    impostaSostitutiva: num(ys['impostaSostitutiva']) ?? d.impostaSostitutiva,
    inpsMode: (ys['inpsMode'] as InpsMode) ?? d.inpsMode,
    inpsCategoria: (ys['inpsCategoria'] as InpsCategoria) ?? null,
    riduzione35: ys['riduzione35'] === 1 || ys['riduzione35'] === true,
    riduzione35Comunicata: ys['riduzione35Comunicata'] === 1 || ys['riduzione35Comunicata'] === true,
    riduzione35DataComunicazione: (ys['riduzione35DataComunicazione'] as string | null) ?? null,
    haRedditoDipendente: ys['haRedditoDipendente'] === 1 || ys['haRedditoDipendente'] === true,
    limiteForfettario: num(ys['limiteForfettario']) ?? d.limiteForfettario,
    scadenziarioMetodo: (ys['scadenziarioMetodo'] as ScadenziarioMetodo) ?? d.scadenziarioMetodo,
    prorogaSaldoAt: (ys['prorogaSaldoAt'] as string | null) ?? null,
    primoAnnoFatturatoPrec: num(ys['primoAnnoFatturatoPrec']),
    primoAnnoImpostaPrec: num(ys['primoAnnoImpostaPrec']),
    primoAnnoAccontiImpostaPrec: num(ys['primoAnnoAccontiImpostaPrec']),
    primoAnnoContribVariabiliPrec: num(ys['primoAnnoContribVariabiliPrec']),
    primoAnnoAccontiContribPrec: num(ys['primoAnnoAccontiContribPrec']),
    tariffaGiornaliera: num(ys['tariffaGiornaliera']),
  };
}

/** Costruisce il body per PUT /api/year-settings/:year da uno stato del form. */
export function bodyFromState(s: YsFormState): Record<string, unknown> {
  const riduzione = s.riduzione35;
  return {
    regime: s.regime,
    coefficiente: s.coefficiente,
    impostaSostitutiva: s.impostaSostitutiva,
    inpsMode: s.inpsMode,
    inpsCategoria: s.inpsMode === 'artigiani_commercianti' ? s.inpsCategoria : null,
    riduzione35: riduzione ? 1 : 0,
    riduzione35Comunicata: riduzione && s.riduzione35Comunicata ? 1 : 0,
    riduzione35DataComunicazione: riduzione && s.riduzione35Comunicata ? s.riduzione35DataComunicazione : null,
    haRedditoDipendente: s.haRedditoDipendente ? 1 : 0,
    limiteForfettario: s.limiteForfettario,
    scadenziarioMetodo: s.scadenziarioMetodo,
    prorogaSaldoAt: s.prorogaSaldoAt,
    primoAnnoFatturatoPrec: s.primoAnnoFatturatoPrec,
    primoAnnoImpostaPrec: s.primoAnnoImpostaPrec,
    primoAnnoAccontiImpostaPrec: s.primoAnnoAccontiImpostaPrec,
    primoAnnoContribVariabiliPrec: s.primoAnnoContribVariabiliPrec,
    primoAnnoAccontiContribPrec: s.primoAnnoAccontiContribPrec,
    tariffaGiornaliera: s.tariffaGiornaliera,
  };
}

export interface AtecoOption { label: string; coefficiente: number }

export function atecoOptions(): AtecoOption[] {
  return atecoGruppiUI().map((g) => ({ label: g.label, coefficiente: g.coefficiente }));
}

/** Indice del primo gruppo ATECO col coefficiente dato; -1 se nessuno. */
export function selectedAtecoIndex(coefficiente: number, opts: AtecoOption[]): number {
  return opts.findIndex((o) => o.coefficiente === coefficiente);
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/lib/year-settings-form.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/year-settings-form.ts src/client/lib/year-settings-form.test.ts
git commit -m "feat(client): logica pura editor parametri (year-settings-form)"
```

---

## Task 4: Render puri della pagina Impostazioni

**Files:**
- Create: `src/client/pages/impostazioni.ts` (parte 1: render puri + import)
- Test: `src/client/pages/impostazioni.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/pages/impostazioni.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderForm, renderConfigBanner } from './impostazioni';
import { defaults } from '../lib/year-settings-form';

test('renderForm: campi core presenti, ordinario disabilitato', () => {
  const html = renderForm(defaults());
  assert.match(html, /Forfettario/);
  assert.match(html, /Ordinario/);
  assert.match(html, /disabled/);           // toggle ordinario disabilitato
  assert.match(html, /data-field="coefficiente"/);
  assert.match(html, /data-field="impostaSostitutiva"/);
  assert.match(html, /data-field="inpsMode"/);
  assert.match(html, /data-field="limiteForfettario"/);
  assert.match(html, /Salva parametri/);
});

test('renderForm: sezione avanzate collassata (details senza open)', () => {
  const html = renderForm(defaults());
  assert.match(html, /<details class="ys-advanced">/);
  assert.doesNotMatch(html, /<details class="ys-advanced" open>/);
});

test('renderForm: pre-seleziona il coefficiente salvato (78%)', () => {
  const html = renderForm({ ...defaults(), coefficiente: 0.78 });
  assert.match(html, /value="0.78"[^>]*selected/);
});

test('renderForm: categoria INPS mostrata solo con artigiani_commercianti', () => {
  const sep = renderForm({ ...defaults(), inpsMode: 'gestione_separata' });
  assert.doesNotMatch(sep, /data-field="inpsCategoria"/);
  const ac = renderForm({ ...defaults(), inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano' });
  assert.match(ac, /data-field="inpsCategoria"/);
});

test('renderConfigBanner: appare solo per anno nuovo', () => {
  assert.match(renderConfigBanner(true, 2026), /non ancora configurato/i);
  assert.equal(renderConfigBanner(false, 2026), '');
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/pages/impostazioni.test.ts`
Expected: FAIL — `./impostazioni` non esiste.

- [ ] **Step 3: Implementare i render puri**

Create `src/client/pages/impostazioni.ts` (solo render + import; mount nel Task 5):

```ts
// src/client/pages/impostazioni.ts
//
// Pagina "Impostazioni" (/impostazioni): editor dei parametri fiscali per-anno
// (year_settings). Raggiunta dal menu profilo, non dalla nav principale.
// Render puri (testabili) + mount con fetch/save. Frontend-only: il backend
// GET/PUT /api/year-settings/:year esiste già (boundary check server-side).

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import {
  defaults, stateFromResponse, bodyFromState, atecoOptions, selectedAtecoIndex,
  type YsFormState,
} from '../lib/year-settings-form';

// ── helpers ──

function pctLabel(coeff: number): string {
  return Math.round(coeff * 100) + '%';
}

// ── render puri ──

export function renderConfigBanner(isNew: boolean, year: number): string {
  if (!isNew) return '';
  return `<div class="ys-banner">Anno ${esc(year)} non ancora configurato: questi sono i valori di default, modifica e salva.</div>`;
}

export function renderForm(s: YsFormState): string {
  const opts = atecoOptions();
  const selIdx = selectedAtecoIndex(s.coefficiente, opts);
  const atecoHtml = opts.map((o, i) =>
    `<option value="${esc(o.coefficiente)}"${i === selIdx ? ' selected' : ''}>${esc(o.label)} — ${esc(pctLabel(o.coefficiente))}</option>`,
  ).join('');

  const categoriaHtml = s.inpsMode === 'artigiani_commercianti'
    ? `<div class="ys-field">
        <label>Categoria</label>
        <select data-field="inpsCategoria">
          <option value="artigiano"${s.inpsCategoria === 'artigiano' ? ' selected' : ''}>Artigiano</option>
          <option value="commerciante"${s.inpsCategoria === 'commerciante' ? ' selected' : ''}>Commerciante</option>
        </select>
      </div>`
    : '';

  const riduzioneSub = s.riduzione35
    ? `<div class="ys-sub">
        <label class="ys-check"><input type="checkbox" data-field="riduzione35Comunicata"${s.riduzione35Comunicata ? ' checked' : ''}> Comunicata all'INPS</label>
        <div class="ys-field">
          <label>Data comunicazione</label>
          <input type="date" data-field="riduzione35DataComunicazione" value="${esc(s.riduzione35DataComunicazione ?? '')}">
        </div>
      </div>`
    : '';

  return `<form class="card ys-form" data-ys-form>
    <div class="ys-grid">
      <div class="ys-field">
        <label>Regime</label>
        <div class="ys-toggle" data-field="regime">
          <button type="button" class="ys-toggle-btn is-active" data-regime="forfettario">Forfettario</button>
          <button type="button" class="ys-toggle-btn is-disabled" data-regime="ordinario" disabled title="non ancora supportato">Ordinario ✕</button>
        </div>
        <span class="ys-hint">Ordinario non ancora supportato.</span>
      </div>

      <div class="ys-field">
        <label>Imposta sostitutiva</label>
        <div class="ys-seg" data-field="impostaSostitutiva">
          <button type="button" class="ys-seg-btn${s.impostaSostitutiva === 0.15 ? ' is-active' : ''}" data-sost="0.15">15% standard</button>
          <button type="button" class="ys-seg-btn${s.impostaSostitutiva === 0.05 ? ' is-active' : ''}" data-sost="0.05">5% startup</button>
        </div>
      </div>

      <div class="ys-field">
        <label>Attività ATECO → coefficiente</label>
        <select data-field="coefficiente">${atecoHtml}</select>
        <span class="ys-hint">DM 23/01/2015. Coefficiente: ${esc(pctLabel(s.coefficiente))}.</span>
      </div>

      <div class="ys-field">
        <label>Gestione INPS</label>
        <select data-field="inpsMode">
          <option value="gestione_separata"${s.inpsMode === 'gestione_separata' ? ' selected' : ''}>Gestione Separata</option>
          <option value="artigiani_commercianti"${s.inpsMode === 'artigiani_commercianti' ? ' selected' : ''}>Artigiani / Commercianti</option>
        </select>
      </div>

      ${categoriaHtml}

      <div class="ys-field">
        <label>Limite forfettario (€)</label>
        <input type="number" data-field="limiteForfettario" value="${esc(s.limiteForfettario)}" step="1" min="0">
      </div>

      <div class="ys-field">
        <label>Tariffa giornaliera (€)</label>
        <input type="number" data-field="tariffaGiornaliera" value="${esc(s.tariffaGiornaliera ?? '')}" step="0.01" min="0" placeholder="es. 250">
        <span class="ys-hint">Usata anche da “Crea fattura dal calendario”.</span>
      </div>
    </div>

    <div class="ys-checks">
      <label class="ys-check"><input type="checkbox" data-field="riduzione35"${s.riduzione35 ? ' checked' : ''}> Riduzione contributiva 35% (artigiani/commercianti)</label>
      ${riduzioneSub}
      <label class="ys-check"><input type="checkbox" data-field="haRedditoDipendente"${s.haRedditoDipendente ? ' checked' : ''}> Ho anche reddito da lavoro dipendente</label>
    </div>

    <details class="ys-advanced">
      <summary>Impostazioni avanzate</summary>
      <div class="ys-grid">
        <div class="ys-field">
          <label>Metodo scadenziario</label>
          <select data-field="scadenziarioMetodo">
            <option value="storico"${s.scadenziarioMetodo === 'storico' ? ' selected' : ''}>Storico</option>
            <option value="previsionale"${s.scadenziarioMetodo === 'previsionale' ? ' selected' : ''}>Previsionale</option>
          </select>
        </div>
        <div class="ys-field">
          <label>Proroga saldo (solo luglio)</label>
          <input type="date" data-field="prorogaSaldoAt" value="${esc(s.prorogaSaldoAt ?? '')}">
        </div>
        <div class="ys-field"><label>Primo anno — fatturato prec.</label><input type="number" data-field="primoAnnoFatturatoPrec" value="${esc(s.primoAnnoFatturatoPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — imposta prec.</label><input type="number" data-field="primoAnnoImpostaPrec" value="${esc(s.primoAnnoImpostaPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — acconti imposta prec.</label><input type="number" data-field="primoAnnoAccontiImpostaPrec" value="${esc(s.primoAnnoAccontiImpostaPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — contributi variabili prec.</label><input type="number" data-field="primoAnnoContribVariabiliPrec" value="${esc(s.primoAnnoContribVariabiliPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — acconti contributi prec.</label><input type="number" data-field="primoAnnoAccontiContribPrec" value="${esc(s.primoAnnoAccontiContribPrec ?? '')}" step="0.01"></div>
      </div>
    </details>

    <div class="ys-actions">
      <span class="ys-msg" data-ys-msg></span>
      <button type="button" class="btn" data-ys-reset>Annulla</button>
      <button type="submit" class="btn btn-primary" data-ys-save>Salva parametri</button>
    </div>
  </form>`;
}

export function renderPage(s: YsFormState, isNew: boolean, year: number): string {
  return `<div class="ys-page">
    <div class="ys-crumb">Profilo ▸ Impostazioni</div>
    <h2>Impostazioni — Parametri fiscali ${esc(year)}</h2>
    ${renderConfigBanner(isNew, year)}
    ${renderForm(s)}
  </div>`;
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/pages/impostazioni.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS. (Import `api`/`ApiError`/`mountPage`/`getYear`/`stateFromResponse`/`bodyFromState` non ancora usati: ok, servono al Task 5; tsconfig non ha `noUnusedLocals`.)

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/impostazioni.ts src/client/pages/impostazioni.test.ts
git commit -m "feat(client): render puri pagina Impostazioni (form parametri)"
```

---

## Task 5: mount() della pagina Impostazioni (fetch / save / reset)

**Files:**
- Modify: `src/client/pages/impostazioni.ts` (append `mount`)

- [ ] **Step 1: Append `mount`**

In coda a `src/client/pages/impostazioni.ts`:

```ts
// ── mount ──

interface YearSettingsResponse { yearSettings: Record<string, unknown> }

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/impostazioni',
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card ys-note">Carico le impostazioni…</div>`;

      let state: YsFormState;
      let isNew = false;
      try {
        const resp = await api.get<YearSettingsResponse>(`/api/year-settings/${year}`);
        state = stateFromResponse(resp.yearSettings);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          state = defaults();
          isNew = true;
        } else {
          const msg = err instanceof ApiError ? err.message : 'Impossibile caricare le impostazioni. Riprova.';
          main.innerHTML = `<div class="card ys-note ys-note-warn">${esc(msg)}</div>`;
          return;
        }
      }

      function render() {
        main.innerHTML = renderPage(state, isNew, year);
        const form = main.querySelector<HTMLFormElement>('[data-ys-form]')!;
        const msgEl = main.querySelector<HTMLElement>('[data-ys-msg]')!;

        // helper: legge un campo dal DOM nello stato
        function bind<K extends keyof YsFormState>(sel: string, read: (el: HTMLInputElement | HTMLSelectElement) => YsFormState[K], key: K, rerender = false): void {
          const el = main.querySelector<HTMLInputElement | HTMLSelectElement>(sel);
          el?.addEventListener('change', () => {
            state[key] = read(el);
            if (rerender) render();
          });
        }

        // regime: solo forfettario attivabile (ordinario disabled)
        // imposta sostitutiva segmento
        main.querySelectorAll<HTMLButtonElement>('[data-sost]').forEach((b) => {
          b.addEventListener('click', () => { state.impostaSostitutiva = Number(b.dataset['sost']); render(); });
        });

        bind('[data-field="coefficiente"]', (el) => Number((el as HTMLSelectElement).value), 'coefficiente');
        bind('[data-field="inpsMode"]', (el) => (el as HTMLSelectElement).value as YsFormState['inpsMode'], 'inpsMode', true);
        bind('[data-field="inpsCategoria"]', (el) => (el as HTMLSelectElement).value as YsFormState['inpsCategoria'], 'inpsCategoria');
        bind('[data-field="limiteForfettario"]', (el) => Number((el as HTMLInputElement).value) || 0, 'limiteForfettario');
        bind('[data-field="tariffaGiornaliera"]', (el) => { const v = (el as HTMLInputElement).value; return v === '' ? null : Number(v); }, 'tariffaGiornaliera');
        bind('[data-field="scadenziarioMetodo"]', (el) => (el as HTMLSelectElement).value as YsFormState['scadenziarioMetodo'], 'scadenziarioMetodo');
        bind('[data-field="prorogaSaldoAt"]', (el) => { const v = (el as HTMLInputElement).value; return v === '' ? null : v; }, 'prorogaSaldoAt');
        bind('[data-field="riduzione35"]', (el) => (el as HTMLInputElement).checked, 'riduzione35', true);
        bind('[data-field="riduzione35Comunicata"]', (el) => (el as HTMLInputElement).checked, 'riduzione35Comunicata');
        bind('[data-field="riduzione35DataComunicazione"]', (el) => { const v = (el as HTMLInputElement).value; return v === '' ? null : v; }, 'riduzione35DataComunicazione');
        bind('[data-field="haRedditoDipendente"]', (el) => (el as HTMLInputElement).checked, 'haRedditoDipendente');

        for (const k of ['primoAnnoFatturatoPrec','primoAnnoImpostaPrec','primoAnnoAccontiImpostaPrec','primoAnnoContribVariabiliPrec','primoAnnoAccontiContribPrec'] as const) {
          bind(`[data-field="${k}"]`, (el) => { const v = (el as HTMLInputElement).value; return v === '' ? null : Number(v); }, k);
        }

        main.querySelector<HTMLButtonElement>('[data-ys-reset]')?.addEventListener('click', () => { render(); });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          msgEl.textContent = 'Salvataggio…';
          msgEl.className = 'ys-msg';
          try {
            const resp = await api.put<YearSettingsResponse>(`/api/year-settings/${year}`, bodyFromState(state));
            state = stateFromResponse(resp.yearSettings);
            isNew = false;
            render();
            const m = main.querySelector<HTMLElement>('[data-ys-msg]');
            if (m) { m.textContent = 'Salvato ✓'; m.className = 'ys-msg is-ok'; }
          } catch (err) {
            const text = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
            msgEl.textContent = text;
            msgEl.className = 'ys-msg is-err';
          }
        });
      }

      render();
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Confermare test render ancora verdi**

Run: `node --import tsx --test src/client/pages/impostazioni.test.ts`
Expected: PASS (i render puri non sono cambiati).

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/impostazioni.ts
git commit -m "feat(client): mount Impostazioni (fetch year-settings, save PUT, reset)"
```

---

## Task 6: Etichette route fuori-nav (`lib/nav.ts`)

**Files:**
- Modify: `src/client/lib/nav.ts`
- Test: `src/client/lib/nav.test.ts`

- [ ] **Step 1: Aggiungere il test**

In `src/client/lib/nav.test.ts` aggiungere:

```ts
import { labelForRoute } from './nav';

test('labelForRoute: route fuori-nav del menu profilo hanno etichetta', () => {
  assert.equal(labelForRoute('/impostazioni'), 'Impostazioni');
  assert.equal(labelForRoute('/riepilogo'), 'Riepilogo');
  assert.equal(labelForRoute('/profilo-personale'), 'Profilo personale');
  assert.equal(labelForRoute('/profilo-piva'), 'Profilo P.IVA');
});
```

(Riusa gli import `test`/`assert` già presenti in cima al file.)

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/lib/nav.test.ts`
Expected: FAIL — labelForRoute ritorna '' per queste route.

- [ ] **Step 3: Implementare**

In `src/client/lib/nav.ts`, sostituire la funzione `labelForRoute` con:

```ts
/** Etichette per route raggiungibili fuori dalla nav principale (menu profilo). */
const EXTRA_LABELS: Record<string, string> = {
  '/impostazioni': 'Impostazioni',
  '/riepilogo': 'Riepilogo',
  '/profilo-personale': 'Profilo personale',
  '/profilo-piva': 'Profilo P.IVA',
};

export function labelForRoute(route: string): string {
  for (const s of NAV_SECTIONS) for (const i of s.items) if (i.route === route) return i.label;
  return EXTRA_LABELS[route] ?? '';
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/lib/nav.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/nav.ts src/client/lib/nav.test.ts
git commit -m "feat(client): etichette route menu profilo (labelForRoute)"
```

---

## Task 7: Menu profilo nel footer della sidebar

**Files:**
- Modify: `src/client/components/sidebar.ts`
- Test: `src/client/components/sidebar.test.ts`

- [ ] **Step 1: Aggiornare/aggiungere i test**

In `src/client/components/sidebar.test.ts`: il test esistente `renderSidebar: footer con nome profilo, switch e logout` resta valido (nome profilo, data-profile-switch, data-logout, option). Aggiungere:

```ts
test('renderSidebar: footer ha trigger menu profilo e le voci', () => {
  const html = renderSidebar(me, '/', 2026);
  assert.match(html, /data-profile-trigger/);
  assert.match(html, /data-profile-menu/);
  assert.match(html, /data-route="\/impostazioni"/);
  assert.match(html, /data-route="\/riepilogo"/);
  assert.match(html, /data-route="\/profilo-personale"/);
  assert.match(html, /data-route="\/profilo-piva"/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /data-logout/);
});

test('renderSidebar: le 3 voci future hanno il badge presto', () => {
  const html = renderSidebar(me, '/', 2026);
  const presto = (html.match(/sb-menu-tag/g) ?? []).length;
  assert.equal(presto, 3);
});
```

NB: se un test esistente asserisce "tutte le voci sono link (nessuna disabilitata)" sulla NAV principale, resta valido (riguarda `.sb-item`, non il menu profilo). Verificarlo e non romperlo.

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/components/sidebar.test.ts`
Expected: FAIL — i nuovi `data-profile-trigger`/`data-profile-menu`/voci non esistono.

- [ ] **Step 3: Implementare il footer con menu**

In `src/client/components/sidebar.ts`:

(a) In cima al file aggiungere l'import del tema:
```ts
import { getTheme, toggleTheme, applyTheme } from '../lib/theme';
```

(b) Sostituire il blocco `<div class="sb-footer"> … </div>` dentro `renderSidebar` con:

```ts
        <div class="sb-footer">
          <div class="sb-profile-menu" data-profile-menu hidden role="menu">
            ${me.profiles.length > 1 ? `<select class="input sb-profile-select" data-profile-switch aria-label="Profilo attivo">${options}</select>` : ''}
            <a class="sb-menu-item" role="menuitem" data-route="/riepilogo" href="/riepilogo">Riepilogo <span class="sb-menu-tag">presto</span></a>
            <a class="sb-menu-item" role="menuitem" data-route="/profilo-personale" href="/profilo-personale">Profilo personale <span class="sb-menu-tag">presto</span></a>
            <a class="sb-menu-item" role="menuitem" data-route="/profilo-piva" href="/profilo-piva">Profilo P.IVA <span class="sb-menu-tag">presto</span></a>
            <a class="sb-menu-item" role="menuitem" data-route="/impostazioni" href="/impostazioni">Impostazioni</a>
            <button class="sb-menu-item" type="button" role="menuitem" data-theme-toggle>Tema <span class="sb-menu-val" data-theme-label>${getTheme() === 'light' ? 'chiaro' : 'scuro'}</span></button>
            <div class="sb-menu-sep"></div>
            <button class="sb-menu-item is-logout" type="button" role="menuitem" data-logout>Logout</button>
          </div>
          <div class="sb-footer-row">
            <button class="sb-profile" type="button" data-profile-trigger aria-haspopup="menu" aria-expanded="false" title="Menu profilo">
              <span class="sb-avatar" aria-hidden="true">${initial}</span>
              <span class="sb-profile-name">${esc(me.activeProfile.displayName)}</span>
            </button>
            <button class="sb-collapse-btn" type="button" data-sb-collapse aria-label="Comprimi/espandi barra laterale" title="Comprimi barra laterale">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
            </button>
          </div>
        </div>
```

(c) In `wireSidebar`, aggiungere dopo le query esistenti e i listener:

```ts
  const trigger = q<HTMLButtonElement>('[data-profile-trigger]');
  const menu = q<HTMLElement>('[data-profile-menu]');
  const themeToggle = q<HTMLButtonElement>('[data-theme-toggle]');
  const themeLabel = q<HTMLElement>('[data-theme-label]');

  function setMenuOpen(open: boolean): void {
    if (!menu || !trigger) return;
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function onTrigger(e: MouseEvent): void { e.stopPropagation(); setMenuOpen(menu?.hidden ?? true); }
  function onDocClick(e: MouseEvent): void {
    if (!menu || menu.hidden) return;
    const t = e.target as Node;
    if (!menu.contains(t) && !trigger?.contains(t)) setMenuOpen(false);
  }
  function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') setMenuOpen(false); }
  function onTheme(): void {
    toggleTheme();
    applyTheme();
    if (themeLabel) themeLabel.textContent = getTheme() === 'light' ? 'chiaro' : 'scuro';
  }

  trigger?.addEventListener('click', onTrigger);
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  themeToggle?.addEventListener('click', onTheme);
```

E nel cleanup ritornato, aggiungere le rimozioni:

```ts
    trigger?.removeEventListener('click', onTrigger);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    themeToggle?.removeEventListener('click', onTheme);
```

(I link `data-route` del menu navigano tramite il listener globale di `main.ts`; la navigazione re-renderizza la sidebar, chiudendo il menu.)

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/components/sidebar.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/sidebar.ts src/client/components/sidebar.test.ts
git commit -m "feat(client): menu profilo nel footer sidebar (popup + tema)"
```

---

## Task 8: Routing — `/impostazioni` + placeholder + tema al boot

**Files:**
- Modify: `src/client/main.ts`

- [ ] **Step 1: Aggiungere route, placeholder e applicazione tema**

In `src/client/main.ts`:

(a) Aggiungere in cima l'import del tema:
```ts
import { applyTheme } from './lib/theme';
```

(b) Nel mapping `routes`, aggiungere (dopo `/dichiarazione`):
```ts
  '/impostazioni': () => import('./pages/impostazioni'),
  '/riepilogo': () => import('./pages/placeholder'),
  '/profilo-personale': () => import('./pages/placeholder'),
  '/profilo-piva': () => import('./pages/placeholder'),
```

(c) Prima della prima chiamata `navigate(location.pathname, false);`, applicare il tema:
```ts
applyTheme();
```

- [ ] **Step 2: Typecheck + build web**

Run: `npm run typecheck`
Run: `npm run build:web`
Expected: PASS / build OK.

- [ ] **Step 3: Commit**

```bash
git add src/client/main.ts
git commit -m "feat(client): route /impostazioni + placeholder menu profilo + tema al boot"
```

---

## Task 9: CTA needsConfig → `/impostazioni`

**Files:**
- Modify: `src/client/pages/regime.ts`, `src/client/pages/tasse.ts`, `src/client/pages/budget.ts`

- [ ] **Step 1: regime.ts**

In `src/client/pages/regime.ts`, dentro `renderNeedsConfig`, sostituire:
```ts
      <a class="btn btn-primary" href="/tasse" data-route="/tasse">Configura il ${esc(year)}</a>
```
con:
```ts
      <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
```

- [ ] **Step 2: tasse.ts**

In `src/client/pages/tasse.ts`, dentro `renderNeedsConfig`, sostituire:
```ts
    <a class="btn btn-primary" href="/" data-route="/">Configura il ${esc(year)}</a>
```
con:
```ts
    <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
```

- [ ] **Step 3: budget.ts**

In `src/client/pages/budget.ts`, dentro `renderNeedsConfig`, sostituire:
```ts
    <a class="btn btn-primary" href="/" data-route="/">Configura il ${esc(year)}</a>
```
con:
```ts
    <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
```

- [ ] **Step 4: Verificare i test pagina ancora verdi + typecheck**

Run: `node --import tsx --test src/client/pages/budget.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS. (Se un test asseriva `data-route="/"` nella CTA budget, aggiornarlo a `/impostazioni`.)

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/regime.ts src/client/pages/tasse.ts src/client/pages/budget.ts
git commit -m "feat(client): CTA needsConfig puntano a /impostazioni"
```

---

## Task 10: Stili (menu popup + pagina Impostazioni)

**Files:**
- Modify: `src/client/styles/index.css`

- [ ] **Step 1: Appendere gli stili**

In coda a `src/client/styles/index.css`:

```css
/* ── Menu profilo (sidebar footer) ───────────────────────────────────── */
.sb-footer-row { display: flex; align-items: center; gap: 8px; }
.sb-profile { flex: 1; display: flex; align-items: center; gap: 10px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 8px; padding: 7px 9px; cursor: pointer; color: var(--text); text-align: left; }
.sb-avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, var(--color-tertiary), var(--color-primary)); display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; flex-shrink: 0; }
.sb-profile-name { font-weight: 700; font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-profile-menu { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: var(--shadow-modal); padding: 8px; margin-bottom: 8px; }
.sb-profile-menu[hidden] { display: none; }
.sb-profile-menu .sb-profile-select { width: 100%; margin-bottom: 6px; }
.sb-menu-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 12px; border-radius: 8px; color: var(--text); font-weight: 600; font-size: .88rem; background: none; border: none; cursor: pointer; text-align: left; }
.sb-menu-item:hover { background: var(--color-surface-3); }
.sb-menu-tag { font-size: .6rem; border: 1px solid var(--text3); border-radius: 999px; padding: 1px 6px; color: var(--text3); font-weight: 500; }
.sb-menu-val { font-size: .78rem; color: var(--text2); font-weight: 500; }
.sb-menu-sep { height: 1px; background: var(--color-border); margin: 6px 4px; }
.sb-menu-item.is-logout { color: var(--color-tertiary); }

/* ── Pagina Impostazioni ─────────────────────────────────────────────── */
.ys-crumb { font-size: .74rem; color: var(--text3); margin-bottom: 6px; }
.ys-banner { background: rgba(93,170,138,.10); border: 1px solid var(--color-primary); color: var(--text); font-size: .82rem; padding: 8px 12px; border-radius: 8px; margin-bottom: 16px; }
.ys-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; }
.ys-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 4px; }
.ys-field > label { font-size: .78rem; color: var(--text2); }
.ys-hint { font-size: .68rem; color: var(--text3); }
.ys-toggle, .ys-seg { display: flex; border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; width: max-content; }
.ys-toggle-btn, .ys-seg-btn { background: var(--color-bg); border: none; color: var(--text2); padding: 8px 16px; font-size: .85rem; cursor: pointer; }
.ys-toggle-btn.is-active { background: var(--color-primary); color: #10110d; font-weight: 700; }
.ys-toggle-btn.is-disabled { color: var(--text3); opacity: .5; cursor: not-allowed; }
.ys-seg-btn.is-active { background: var(--color-surface-3); color: var(--text); font-weight: 600; }
.ys-checks { margin-top: 14px; display: flex; flex-direction: column; gap: 4px; }
.ys-check { display: flex; align-items: center; gap: 9px; font-size: .86rem; }
.ys-check input { width: 16px; height: 16px; accent-color: var(--color-primary); }
.ys-sub { margin: 6px 0 6px 26px; padding-left: 14px; border-left: 2px solid var(--color-border); display: flex; flex-direction: column; gap: 8px; }
.ys-advanced { margin-top: 18px; border-top: 1px solid var(--color-border); padding-top: 12px; }
.ys-advanced > summary { color: var(--text2); font-size: .84rem; font-weight: 600; cursor: pointer; margin-bottom: 12px; }
.ys-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 20px; }
.ys-msg { margin-right: auto; font-size: .82rem; color: var(--text2); }
.ys-msg.is-ok { color: var(--green); }
.ys-msg.is-err { color: var(--color-error); }
.ys-note { color: var(--text2); font-size: .88rem; }
.ys-note-warn { color: var(--color-error); }
```

- [ ] **Step 2: Build web**

Run: `npm run build:web`
Expected: build OK senza errori CSS.

- [ ] **Step 3: Commit**

```bash
git add src/client/styles/index.css
git commit -m "style(client): stili menu profilo + pagina Impostazioni"
```

---

## Task 11: Verifica finale

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: tutti i test verdi (inclusi: ateco, theme, year-settings-form, impostazioni render, nav, sidebar). NB: su Windows un raro fallimento flaky di `scadenziario-service.test.ts` sotto run parallela è benigno (contesa DB temp libsql) — rieseguire/verificare in isolamento.

- [ ] **Step 2: Typecheck + build completa**

Run: `npm run typecheck`
Run: `npm run build`
Expected: PASS / build web+server OK.

- [ ] **Step 3: Smoke manuale (raccomandato)**

`npm run dev`, login → click sul profilo (footer) → si apre il menu → "Impostazioni" apre `/impostazioni` (anno dalla barra). Modifica un campo e Salva → "Salvato ✓"; ricarica → valori persistiti. Cambia coefficiente non valido non è possibile (select). Toggle "Tema" → la UI passa a chiaro/scuro e persiste al reload. Voci "presto" aprono il placeholder. CTA needsConfig (su un anno non configurato in Regime/Tasse/Budget) porta a `/impostazioni`.

---

## Self-Review (compilata in stesura)

**Spec coverage:**
- Menu profilo footer (trigger + popup + voci + switch profilo + Esc/outside-close) → Task 7. ✓
- Voci Riepilogo/Profilo personale/Profilo P.IVA navigabili a placeholder → Task 7 (link) + Task 8 (route) + Task 6 (etichette). ✓ (Nota: la spec menzionava `aria-disabled`; risolta come **link navigabili** con badge "presto", coerente con "menu completo navigabile" richiesto dall'utente.)
- Impostazioni `/impostazioni` year-scoped, fetch 200/404, save PUT, errori 400/422, reset → Task 4+5. ✓
- Campi core + avanzate collassabili (5 campi primo anno) → Task 4. ✓
- Coefficiente via select ATECO + pre-selezione → Task 1 (export) + Task 3 (opzioni) + Task 4 (render). ✓
- Default primo uso (78% / 15% / gestione separata / 85000 / storico) → Task 3 `defaults()`. ✓
- inpsCategoria null se gestione separata; riduzione comunicata/data solo se attiva → Task 3 `bodyFromState` + Task 4 render condizionale. ✓
- Tema dark/light, storage, applicato al boot, toggle dal menu → Task 2 + Task 7 + Task 8. ✓
- CTA needsConfig → /impostazioni → Task 9. ✓
- Stili → Task 10. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice completo.

**Type consistency:** `YsFormState` definito in Task 3 e usato in Task 4/5; `atecoGruppiUI` (Task 1) → `atecoOptions`/`selectedAtecoIndex` (Task 3) → render (Task 4). `getTheme/toggleTheme/applyTheme` (Task 2) usati in Task 7/8. Endpoint `/api/year-settings/:year` GET ritorna `{ yearSettings }`, PUT idem (Task 5 coerente con `year-settings.ts`). `bodyFromState` produce flag 0/1 come richiesto da `YearSettingsInput` (z.literal(0|1)).

**Nota di rischio:** `bind()` in Task 5 usa una signature generica con `read` che ritorna `YsFormState[K]`; se il typecheck di TS si lamenta della union dei tipi di ritorno, racchiudere l'assegnazione con un cast mirato (`(state as Record<string, unknown>)[key] = ...`) mantenendo i singoli `read` tipizzati. Preferire la forma senza cast se compila.
