# Riepilogo (cruscotto cross-modulo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare `/riepilogo` in un cruscotto annuale che aggrega sintesi fiscale, fatturato+limite 85k, prossime scadenze e CTA Dichiarazione, con ogni card che linka alla pagina dedicata.

**Architecture:** Frontend-only, nessun endpoint nuovo, nessuna migration. La pagina `pages/riepilogo.ts` (pattern `regime.ts`: render puri testabili + `mount`) esegue due fetch in parallelo (`Promise.allSettled`): `GET /api/tax/scenario?year=` (card Sintesi + Fatturato/limite) e `GET /api/scadenziario/:year` (card Prossime scadenze). I tipi degli endpoint sono riusati via `import type` dai sibling `regime.ts`/`scadenze.ts`. Ogni card degrada in modo indipendente (needsConfig / errore).

**Tech Stack:** TypeScript strict (noUncheckedIndexedAccess), Vite vanilla DOM, Node `--test`.

---

## File Structure

- Create: `src/client/pages/riepilogo.ts` — funzione pura `prossimeScadenze`, render puri delle card, `mount`.
- Test: `src/client/pages/riepilogo.test.ts`.
- Modify: `src/client/main.ts` — route `/riepilogo` → pagina reale (oggi placeholder).
- Modify: `src/client/styles/index.css` — stili `riep-*` (riusa `.card`, `.progress-bar`/`.progress-fill`/`.progress-text`, `.chip*` già esistenti).

Note di riuso (verificare i percorsi prima di scrivere):
- `scadenzaTiming(dueDateIso, today)` da `../lib/scadenza-timing` → `{ state, label, tone: 'ok'|'warn'|'danger' }`.
- Tipi: `ScenarioResponse` esportato da `./regime`; `ScadenziarioView`, `ScadenziarioRow` esportati da `./scadenze`; `ForfettarioScenario`, `ComparisonOutput` da `@server/lib/tax-engine` (come fa `regime.ts`).
- `esc`, `mountPage` da `../lib/dom`; `api`, `ApiError` da `../lib/api`; `getYear` da `../lib/year`.

---

## Task 1: `prossimeScadenze()` — selezione pura delle scadenze da pagare

**Files:**
- Create: `src/client/pages/riepilogo.ts` (parte 1: import dei tipi + la funzione pura)
- Test: `src/client/pages/riepilogo.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/pages/riepilogo.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prossimeScadenze } from './riepilogo';
import type { ScadenziarioRow } from './scadenze';

function row(id: string, dueDate: string, point: number, paidTotal: number): ScadenziarioRow {
  return {
    id, title: `Scadenza ${id}`, family: 'f', kind: 'tax', competenceYear: 2026,
    dueDate, dueDateOriginal: dueDate, dueDateRolled: false, prorogaApplied: false,
    amount: { low: point, high: point, point }, certainty: 'official',
    payments: [], paidTotal,
    status: { code: 'underpaid', label: 'x', tone: 'warn' }, explanation: '',
  };
}

test('prossimeScadenze: tiene solo le righe con residuo > 0, ordina per data, taglia a N', () => {
  const rows: ScadenziarioRow[] = [
    row('a', '2026-11-30', 1000, 1000), // saldata → esclusa
    row('b', '2026-06-30', 1000, 200),  // residuo 800
    row('c', '2026-08-20', 500, 0),     // residuo 500
    row('d', '2026-05-16', 300, 0),     // residuo 300
    row('e', '2026-02-16', 100, 0),     // residuo 100
  ];
  const out = prossimeScadenze(rows, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id), ['e', 'd', 'b']); // ordinate per data crescente
});

test('prossimeScadenze: residuo ~0 (tolleranza) escluso', () => {
  const rows = [row('x', '2026-06-30', 1000, 999.999)];
  assert.equal(prossimeScadenze(rows, 4).length, 0);
});

test('prossimeScadenze: nessuna scadenza → array vuoto', () => {
  assert.deepEqual(prossimeScadenze([], 4), []);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/pages/riepilogo.test.ts`
Expected: FAIL — `./riepilogo` non esiste.

- [ ] **Step 3: Implementare** (intestazione del file + la funzione pura)

Create `src/client/pages/riepilogo.ts`:

```ts
// src/client/pages/riepilogo.ts
//
// Pagina "Riepilogo" (/riepilogo): cruscotto annuale che AGGREGA i moduli a colpo
// d'occhio (sintesi fiscale, fatturato + limite 85k, prossime scadenze, CTA
// Dichiarazione). Raggiunta dal menu profilo. NON ri-deriva il dettaglio fiscale
// (resta sulla pagina Regime `/`): qui si sintetizza e si linka alle pagine.
//
// Render puri (testabili) + mount con 2 fetch in parallelo. Frontend-only:
// GET /api/tax/scenario (card 1+2) e GET /api/scadenziario/:year (card 3) esistono.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { scadenzaTiming } from '../lib/scadenza-timing';
import type { ScenarioResponse } from './regime';
import type { ScadenziarioView, ScadenziarioRow } from './scadenze';
import type { ForfettarioScenario } from '@server/lib/tax-engine';

// ── selezione pura ──

/**
 * Prossime scadenze da pagare: righe con residuo (`amount.point - paidTotal`) > 0,
 * ordinate per data di scadenza crescente, troncate alle prime `n`.
 */
export function prossimeScadenze(rows: ScadenziarioRow[], n: number): ScadenziarioRow[] {
  return rows
    .filter((r) => r.amount.point - r.paidTotal > 0.005)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, n);
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/pages/riepilogo.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS. (Import `api`/`ApiError`/`mountPage`/`getYear`/`scadenzaTiming`/`ScenarioResponse`/`ScadenziarioView`/`ForfettarioScenario` non ancora usati: ok, servono ai task successivi; tsconfig non ha `noUnusedLocals`.)

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/riepilogo.ts src/client/pages/riepilogo.test.ts
git commit -m "feat(client): prossimeScadenze() pura per il cruscotto Riepilogo"
```

---

## Task 2: Render puri delle card

**Files:**
- Modify: `src/client/pages/riepilogo.ts` (append: helpers + render puri)
- Test: `src/client/pages/riepilogo.test.ts` (append i test)

- [ ] **Step 1: Append i test** in `src/client/pages/riepilogo.test.ts`:

```ts
import {
  renderSintesiCard, renderLimitCard, renderScadenzeCard,
  renderDichiarazioneCta, renderConfigPrompt,
} from './riepilogo';
import type { ForfettarioScenario } from '@server/lib/tax-engine';

function fakeSelected(over: Partial<ForfettarioScenario> = {}): ForfettarioScenario {
  // Solo i campi usati dalla card sintesi; il resto castato per il test.
  return { substituteTax: 1500, deductibleContributionsPaid: 4000, ...over } as ForfettarioScenario;
}

test('renderSintesiCard: mostra lordo, imposta, INPS, netto e % effettiva + link a /', () => {
  const html = renderSintesiCard(fakeSelected(), 30000, 24500);
  assert.match(html, /Totale annuo lordo/);
  assert.match(html, /Netto annuo/);
  assert.match(html, /Netto mensile/);
  assert.match(html, /effettiva/i);
  assert.match(html, /data-route="\/"/); // "Dettaglio fiscale →"
});

test('renderLimitCard: sotto-soglia nessuna nota; barra con percentuale', () => {
  const html = renderLimitCard(40000, 85000);
  assert.match(html, /progress-fill/);
  assert.match(html, /47%/); // 40000/85000
  assert.doesNotMatch(html, /superata/i);
  assert.match(html, /data-route="\/fatture"/);
});

test('renderLimitCard: ≥100% mostra nota di superamento (rosso)', () => {
  const html = renderLimitCard(90000, 85000);
  assert.match(html, /superata/i);
});

test('renderScadenzeCard: lista righe con chip timing + residuo totale + link', () => {
  const rows: ScadenziarioRow[] = [row('b', '2026-06-30', 1000, 200)];
  const html = renderScadenzeCard(rows, 800, '2026-06-01');
  assert.match(html, /Scadenza b/);
  assert.match(html, /€800,00/);        // residuo della riga
  assert.match(html, /chip/);           // chip timing
  assert.match(html, /Residuo totale/);
  assert.match(html, /data-route="\/scadenze"/);
});

test('renderScadenzeCard: nessuna scadenza → stato vuoto', () => {
  const html = renderScadenzeCard([], 0, '2026-06-01');
  assert.match(html, /Nessuna scadenza/i);
});

test('renderDichiarazioneCta: link a /dichiarazione', () => {
  assert.match(renderDichiarazioneCta(), /data-route="\/dichiarazione"/);
});

test('renderConfigPrompt: punta a /impostazioni e cita l\'anno', () => {
  const html = renderConfigPrompt(2026);
  assert.match(html, /2026/);
  assert.match(html, /data-route="\/impostazioni"/);
});
```

(Riusa l'helper `row()` e gli import `test`/`assert`/`prossimeScadenze`/`ScadenziarioRow` già in cima al file. Aggiungi solo i nuovi import di render e `fakeSelected`.)

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/pages/riepilogo.test.ts`
Expected: FAIL — i render non esistono.

- [ ] **Step 3: Implementare** — append in `src/client/pages/riepilogo.ts`:

```ts
// ── helpers formattativi (coerenti coi sibling regime.ts/scadenze.ts) ──

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(frac: number): string {
  return Math.round((Number(frac) || 0) * 100) + '%';
}
function toneCls(tone: string): string {
  if (tone === 'ok') return 'chip-ok';
  if (tone === 'warn') return 'chip-warn';
  if (tone === 'danger') return 'chip-danger';
  return 'chip-info';
}
function riepRow(label: string, value: string, tone: '' | 'positive' | 'negative' = ''): string {
  const cls = tone ? ` is-${tone}` : '';
  return `<div class="riep-row"><span class="riep-row-label">${esc(label)}</span>`
    + `<span class="riep-row-val${cls}">${esc(value)}</span></div>`;
}
function cardLink(route: string, label: string): string {
  return `<a class="riep-link" href="${esc(route)}" data-route="${esc(route)}">${esc(label)} →</a>`;
}

// ── render puri ──

export function renderSintesiCard(selected: ForfettarioScenario, grossCollected: number, nettoAnnuo: number): string {
  const imposta = selected.substituteTax;
  const inps = selected.deductibleContributionsPaid;
  const netto = Number.isFinite(nettoAnnuo) ? nettoAnnuo : grossCollected - imposta - inps;
  const effettiva = grossCollected > 0 ? (imposta + inps) / grossCollected : 0;
  return `<div class="card riep-card">
      <h3>Sintesi fiscale</h3>
      ${riepRow('Totale annuo lordo', eur(grossCollected))}
      ${riepRow('Imposta sostitutiva', eur(imposta), 'negative')}
      ${riepRow('Contributi INPS', eur(inps), 'negative')}
      ${riepRow('Netto annuo', eur(netto), 'positive')}
      ${riepRow('Netto mensile', eur(netto / 12), 'positive')}
      <div class="riep-note">% effettiva (imposta + INPS sul lordo): <b>${esc(pct(effettiva))}</b></div>
      ${cardLink('/', 'Dettaglio fiscale')}
    </div>`;
}

export function renderLimitCard(grossCollected: number, limite: number): string {
  const lim = limite > 0 ? limite : 85000;
  const ratio = grossCollected / lim;
  const pctNum = Math.round(ratio * 100);
  const width = Math.min(100, pctNum);
  const over = grossCollected >= lim;
  const near = !over && pctNum >= 80;
  const fill = over ? 'var(--color-error)' : near ? 'var(--color-warning)' : 'var(--color-primary)';
  const note = over
    ? `<div class="riep-note riep-note-warn">Soglia ${eur(lim)} superata: uscita immediata oltre 100.000 €, decadenza dall'anno successivo oltre 85.000 €.</div>`
    : near
      ? `<div class="riep-note riep-note-warn">Ti stai avvicinando alla soglia di ${eur(lim)}.</div>`
      : '';
  return `<div class="card riep-card">
      <h3>Fatturato e limite</h3>
      <div class="riep-limit-head">${esc(eur(grossCollected))} <span class="riep-muted">/ ${esc(eur(lim))} incassato</span></div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${width}%;background:${fill};"></div>
        <span class="progress-text">${pctNum}%</span>
      </div>
      ${note}
      ${cardLink('/fatture', 'Fatture')}
    </div>`;
}

export function renderScadenzeCard(prossime: ScadenziarioRow[], totalResidual: number, today: string): string {
  if (!prossime.length) {
    return `<div class="card riep-card">
      <h3>Prossime scadenze</h3>
      <p class="riep-note">Nessuna scadenza da pagare.</p>
      ${cardLink('/scadenze', 'Scadenze')}
    </div>`;
  }
  const items = prossime.map((r) => {
    const residual = Math.max(0, r.amount.point - r.paidTotal);
    const t = scadenzaTiming(r.dueDate, today);
    return `<div class="riep-scad-item">
        <span class="riep-scad-title">${esc(r.title)}</span>
        <span class="chip ${toneCls(t.tone)}">${esc(t.label)}</span>
        <span class="riep-scad-amount">${esc(eur(residual))}</span>
      </div>`;
  }).join('');
  return `<div class="card riep-card">
      <h3>Prossime scadenze</h3>
      <div class="riep-scad-list">${items}</div>
      ${riepRow('Residuo totale anno', eur(totalResidual))}
      ${cardLink('/scadenze', 'Scadenze')}
    </div>`;
}

export function renderDichiarazioneCta(): string {
  return `<div class="card riep-card riep-cta">
      <div>
        <h3>Dichiarazione dei redditi</h3>
        <p class="riep-note">Quadri LM/RR/RS/RX e modello F24 dell'anno.</p>
      </div>
      <a class="btn btn-primary" href="/dichiarazione" data-route="/dichiarazione">Apri Dichiarazione</a>
    </div>`;
}

export function renderConfigPrompt(year: number): string {
  return `<div class="card riep-card">
      <h3>Posizione fiscale ${esc(year)}</h3>
      <p class="riep-note">Anno non ancora configurato: imposta coefficiente, sostitutiva e gestione INPS per vedere la sintesi.</p>
      <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
    </div>`;
}

export function renderPage(year: number, body: string): string {
  return `<div class="riep-page">
    <div class="ys-crumb">Profilo ▸ Riepilogo</div>
    <h2>Riepilogo ${esc(year)}</h2>
    <div class="riep-grid">${body}</div>
  </div>`;
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/pages/riepilogo.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/riepilogo.ts src/client/pages/riepilogo.test.ts
git commit -m "feat(client): render puri delle card del cruscotto Riepilogo"
```

---

## Task 3: `mount()` — due fetch in parallelo e composizione

**Files:**
- Modify: `src/client/pages/riepilogo.ts` (append `mount`)

- [ ] **Step 1: Append `mount`** in `src/client/pages/riepilogo.ts`:

```ts
// ── mount ──

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/riepilogo',
    render: async ({ main }) => {
      const year = getYear();
      const today = new Date().toISOString().slice(0, 10);
      main.innerHTML = `<div class="card riep-card"><p class="riep-note">Carico il riepilogo…</p></div>`;

      const [scenarioRes, scadRes] = await Promise.allSettled([
        api.get<ScenarioResponse>(`/api/tax/scenario?year=${year}`),
        api.get<ScadenziarioView>(`/api/scadenziario/${year}`),
      ]);

      // ── card fiscali (sintesi + limite) da /api/tax/scenario ──
      let fiscalHtml: string;
      if (scenarioRes.status === 'fulfilled' && !scenarioRes.value.needsConfig && scenarioRes.value.comparison) {
        const data = scenarioRes.value;
        const selected = data.comparison!.selected;
        const gross = data.grossCollected ?? selected.grossCollected;
        const limite = data.limite ?? 85000;
        const nettoAnnuo = data.nettoAnnuo ?? gross - selected.substituteTax - selected.deductibleContributionsPaid;
        fiscalHtml = renderSintesiCard(selected, gross, nettoAnnuo) + renderLimitCard(gross, limite);
      } else {
        fiscalHtml = renderConfigPrompt(year);
      }

      // ── card scadenze da /api/scadenziario/:year ──
      let scadHtml: string;
      if (scadRes.status === 'fulfilled') {
        const view = scadRes.value;
        scadHtml = renderScadenzeCard(prossimeScadenze(view.rows, 4), view.summary.totalResidual, today);
      } else {
        const err = scadRes.reason;
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare le scadenze.';
        scadHtml = `<div class="card riep-card"><h3>Prossime scadenze</h3>`
          + `<p class="riep-note riep-note-warn">${esc(msg)}</p></div>`;
      }

      main.innerHTML = renderPage(year, fiscalHtml + scadHtml + renderDichiarazioneCta());
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`selected.grossCollected` esiste su `ForfettarioScenario` — usato anche da `regime.ts` come fallback; se TS segnalasse il contrario, usa `data.grossCollected ?? 0`.)

- [ ] **Step 3: Confermare i test render ancora verdi**

Run: `node --import tsx --test src/client/pages/riepilogo.test.ts`
Expected: PASS (i render puri non cambiano).

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/riepilogo.ts
git commit -m "feat(client): mount Riepilogo (scenario + scadenziario, allSettled)"
```

---

## Task 4: Routing — collegare la pagina reale

**Files:**
- Modify: `src/client/main.ts`

- [ ] **Step 1: Sostituire il placeholder** in `src/client/main.ts`, nel mapping `routes`:

```ts
  '/riepilogo': () => import('./pages/placeholder'),
```
con:
```ts
  '/riepilogo': () => import('./pages/riepilogo'),
```

- [ ] **Step 2: Typecheck + build web**

Run: `npm run typecheck`
Run: `npm run build:web`
Expected: PASS / build OK.

- [ ] **Step 3: Commit**

```bash
git add src/client/main.ts
git commit -m "feat(client): route /riepilogo alla pagina reale"
```

---

## Task 5: Stili (`riep-*`)

**Files:**
- Modify: `src/client/styles/index.css`

- [ ] **Step 1: Appendere gli stili** in coda a `src/client/styles/index.css` (riusa `.card`, `.progress-bar`/`.progress-fill`/`.progress-text`, `.chip`/`.chip-ok`/`.chip-warn`/`.chip-danger`/`.chip-info`, `.btn`/`.btn-primary` già definiti; `.ys-crumb` dallo slice Impostazioni):

```css
/* ── Cruscotto Riepilogo ─────────────────────────────────────────────── */
.riep-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
.riep-card { display: flex; flex-direction: column; gap: 6px; }
.riep-card > h3 { margin-bottom: 6px; }
.riep-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 3px 0; }
.riep-row-label { font-size: .82rem; color: var(--text2); }
.riep-row-val { font-weight: 600; font-size: .9rem; }
.riep-row-val.is-positive { color: var(--green); }
.riep-row-val.is-negative { color: var(--color-error); }
.riep-note { font-size: .72rem; color: var(--text3); margin-top: 4px; }
.riep-note-warn { color: var(--color-error); }
.riep-limit-head { font-size: 1.05rem; font-weight: 700; margin-bottom: 8px; }
.riep-muted { color: var(--text3); font-weight: 400; font-size: .8rem; }
.riep-link { margin-top: 10px; font-size: .8rem; font-weight: 600; color: var(--color-primary); text-decoration: none; align-self: flex-start; }
.riep-link:hover { text-decoration: underline; }
.riep-scad-list { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
.riep-scad-item { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; font-size: .84rem; }
.riep-scad-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.riep-scad-amount { font-weight: 600; }
.riep-cta { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
```

- [ ] **Step 2: Build web**

Run: `npm run build:web`
Expected: build OK senza errori CSS.

- [ ] **Step 3: Commit**

```bash
git add src/client/styles/index.css
git commit -m "style(client): stili cruscotto Riepilogo (riep-*)"
```

---

## Task 6: Verifica finale

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: tutti i test verdi (inclusi i nuovi di `riepilogo.test.ts`). NB: su Windows un raro fallimento flaky di `scadenziario-service.test.ts`/`fatture.test.ts` sotto run parallela è benigno (contesa DB temp libsql) — rieseguire in isolamento.

- [ ] **Step 2: Typecheck + build completa**

Run: `npm run typecheck`
Run: `npm run build`
Expected: PASS / build web+server OK.

- [ ] **Step 3: Smoke manuale (raccomandato)**

`npm run dev`, login → menu profilo (footer) → "Riepilogo" apre `/riepilogo` (anno dalla barra). Verifica: card Sintesi fiscale (netto/lordo/% effettiva) e Fatturato+barra limite popolate da scenario; card Prossime scadenze con max 4 righe non saldate + chip timing + residuo totale; CTA "Apri Dichiarazione" naviga a `/dichiarazione`; ogni link "→" porta alla pagina giusta. Su un anno non configurato: le card fiscali mostrano il prompt "Configura il `<anno>`" → `/impostazioni`, mentre la card scadenze e la CTA restano. Cambiando anno dalla barra il cruscotto si aggiorna.

---

## Self-Review (compilata in stesura)

**Spec coverage:**
- Cruscotto cross-modulo su `/riepilogo`, frontend-only, no endpoint nuovo → Task 1–4. ✓
- Card Sintesi fiscale (lordo/imposta/INPS/netto annuo+mensile/% effettiva) + link a `/` → `renderSintesiCard` (Task 2). ✓
- Card Fatturato + barra limite 85k (incassato = `grossCollected`, soglie 80%/100%) + link `/fatture` → `renderLimitCard` (Task 2). ✓
- Card Prossime scadenze: N=4 non saldate, ordinate per data, chip timing, residuo totale, link `/scadenze` → `prossimeScadenze` (Task 1) + `renderScadenzeCard` (Task 2). ✓
- CTA Apri Dichiarazione → `renderDichiarazioneCta` (Task 2), link `/dichiarazione`. ✓
- 2 fetch in parallelo `Promise.allSettled`, degrado per-card, needsConfig→`renderConfigPrompt` → `mount` (Task 3). ✓
- Routing placeholder→reale → Task 4. ✓
- Stili → Task 5. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice completo.

**Type consistency:** `prossimeScadenze(rows, n)` definita in Task 1 e usata in Task 3; render definiti in Task 2 e composti in Task 3. `ScenarioResponse` (da `./regime`), `ScadenziarioView`/`ScadenziarioRow` (da `./scadenze`), `ForfettarioScenario` (da `@server/lib/tax-engine`) importati come type. `scadenzaTiming` ritorna `{state,label,tone}` con `tone ∈ {ok,warn,danger}` → `toneCls` mappa a `chip-*`. `today` = `new Date().toISOString().slice(0,10)` come in `scadenze.ts`.

**Nota di rischio:** se `import type { ForfettarioScenario } from '@server/lib/tax-engine'` non è risolvibile lato client per via dei path alias, replicarne in `riepilogo.ts` un'interfaccia locale minimale coi soli campi usati (`substituteTax`, `deductibleContributionsPaid`, `grossCollected`) — ma `regime.ts` lo importa già così, quindi dovrebbe funzionare.
