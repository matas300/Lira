# Tasse Accantonate (calcolato vs versato) — Spec + Implementation Plan

> Eseguire task-by-task in TDD (funzioni pure), commit frequenti.

**Goal:** Pagina "Tasse Accantonate" (`/tasse`): mostra, per l'anno selezionato, quanto andrebbe accantonato di tasse+INPS sul fatturato incassato (calcolato = incassato × % effettiva) confrontato con quanto già versato (pagamenti reali), con tabella per fattura, grafico cumulato e fatture differite. Solo frontend: usa endpoint esistenti.

**Architecture:** Logica di calcolo PURA in `lib/accantonamento.ts` (raggruppa fatture, calcola da-accantonare, serie cumulata maturato/versato, differite). Grafico cumulato SVG puro in `components/cumulative-chart.ts`. Pagina `pages/tasse.ts` con funzioni di render pure + `mount` che fa 3 fetch (`/api/tax/scenario`, `/api/fatture`, `/api/pagamenti`) e compone. Niente backend nuovo.

**Tech Stack:** vanilla TS + Vite, `lib/api`, `lib/dom`, `lib/year`, `node --test`.

---

## Dati di input (endpoint esistenti)

- `GET /api/tax/scenario?year=` → usato per la **% effettiva** = `(selected.substituteTax + selected.deductibleContributionsPaid) / grossCollected` (stessa già mostrata sul Regime). Se `needsConfig` → CTA configura. (`selected = comparison.selected`.)
- `GET /api/fatture` → tutte le fatture del profilo. Filtrare lato client. Campi rilevanti: `importo`, `ritenuta`, `data` (ISO), `annoProgressivo`, `pagAnno`, `pagMese`, `stato`, `clienteSnapshot` (JSON con nome) o `numeroDisplay`. "Incassata nell'anno" = `pagAnno === year`. Imponibile riga = `importo − ritenuta` (coerente con grossCollected del backend).
- `GET /api/pagamenti?year=` → versamenti dell'anno: `{ data, importo, tipo }[]`. "Versato tasse" = somma `importo` (tutti i tipi fiscali: tasse/contributi/misto/inail/camera/bollo — di fatto tutti i pagamenti registrati nello scadenziario).

---

## File structure

- Create: `src/client/lib/accantonamento.ts` + test
- Create: `src/client/components/cumulative-chart.ts` + test
- Create: `src/client/pages/tasse.ts` + test
- Modify: `src/client/main.ts` (`/tasse` → `./pages/tasse`)
- Modify: `src/client/styles/components.css`

---

### Task 1: Calcolo puro (`lib/accantonamento.ts`)

**Files:** Create `src/client/lib/accantonamento.ts`; Test `accantonamento.test.ts`

```ts
export interface AccFattura { importo: number; ritenuta?: number; data: string; annoProgressivo?: number; pagAnno?: number|null; pagMese?: number|null; clienteSnapshot?: string|null; numeroDisplay?: string|null; }
export interface AccPagamento { data: string; importo: number; tipo?: string; }
export interface AccRow { label: string; mese: number; lordo: number; daAccantonare: number; }
export interface AccCumPoint { month: number; maturato: number; versato: number; }
export interface AccDeferred { label: string; importo: number; annoIncasso: number|null; }
export interface AccResult {
  rows: AccRow[];          // fatture incassate nell'anno (pagAnno===year), ordinate per mese
  totals: { lordo: number; daAccantonare: number; versato: number; gap: number }; // gap = daAccantonare − versato
  cumulative: AccCumPoint[]; // mesi 1..12, maturato e versato CUMULATI
  deferred: AccDeferred[];  // emesse nell'anno (anno di `data` === year) ma pagAnno !== year
}
export function computeAccantonamento(args: { fatture: AccFattura[]; pagamenti: AccPagamento[]; year: number; effectiveRate: number }): AccResult;
```

Regole:
- imponibile riga = `importo − (ritenuta ?? 0)`.
- `rows`: fatture con `pagAnno === year`; `mese` = `pagMese ?? (mese da data)`; `daAccantonare = imponibile × effectiveRate` (arrotonda a 2); `label` = nome cliente da `clienteSnapshot` (JSON.parse → `.nome`/`.cessionarioRagione`...) o `numeroDisplay` come fallback.
- `totals.versato` = somma `pagamenti.importo`. `gap = round2(daAccantonare − versato)`.
- `cumulative[m]` per m=1..12: `maturato` = somma daAccantonare delle rows con mese ≤ m; `versato` = somma pagamenti con mese(data) ≤ m.
- `deferred`: fatture con anno di `data` === year e `pagAnno !== year` (incluso null → annoIncasso null).
- `effectiveRate` può essere 0 (gross 0) → daAccantonare 0, nessun crash/NaN.

- [ ] **Step 1: failing test** — seed: 2 fatture incassate 2025 (mesi diversi, una con ritenuta), 1 pagamento, 1 fattura differita. Verifica `rows.length`, `totals.daAccantonare` (= imponibile×rate), `totals.versato`, `gap`, `cumulative` monotono crescente, `deferred.length`. effectiveRate=0 → tutto 0 senza NaN.
- [ ] **Step 2: run fail** `npx tsx --test src/client/lib/accantonamento.test.ts`
- [ ] **Step 3: implementare** (puro, niente DOM/fetch).
- [ ] **Step 4: run pass**
- [ ] **Step 5: commit** `feat(client): calcolo tasse accantonate vs versato (accantonamento.ts)`

---

### Task 2: Grafico cumulato SVG (`components/cumulative-chart.ts`)

**Files:** Create `src/client/components/cumulative-chart.ts`; Test `cumulative-chart.test.ts`

`renderCumulativeChart(points: { month:number; maturato:number; versato:number }[]): string` → SVG con due polilinee (maturato = `--color-tertiary`, versato = `--color-primary`), etichette mesi sull'asse X, legenda. Puro. Gestire: 0 punti → placeholder "Nessun dato"; valori tutti 0 → assi senza crash (no divisione per 0 nella scala).

- [ ] **Step 1: failing test** — 3 punti → stringa con `<svg`, due `<polyline`/`<path`, legenda "Maturato"/"Versato". 0 punti → "Nessun dato". max=0 → nessun NaN nell'output.
- [ ] **Step 2: run fail**
- [ ] **Step 3: implementare** (scala Y = max(maturato,versato) o 1 se 0; coordinate clamp).
- [ ] **Step 4: run pass**
- [ ] **Step 5: commit** `feat(client): grafico cumulato SVG (cumulative-chart.ts)`

---

### Task 3: Funzioni di render pure + mount (`pages/tasse.ts`)

**Files:** Create `src/client/pages/tasse.ts`; Test `tasse.test.ts`

Funzioni pure esportate (riusare `eur`/`esc` come in `regime.ts`):
- `renderStatus(totals)` → "Maturato €X · Versato €Y · Da versare €gap" con tono (gap≤0 → ok "in pari", gap>0 → warn).
- `renderTable(rows)` → tabella Fattura | Lordo | Da accantonare (+ footer totali).
- `renderDeferred(deferred)` → tabella fatture differite (vuota → nota).
- `renderNeedsConfig(year)` → CTA configura (come regime).
- `renderTasse(result, chartSvg)` → compone status + grafico + tabella + differite.

`mount` (`mountPage({route:'/tasse'})`): legge `getYear()`, in parallelo `api.get('/api/tax/scenario?year='+y)`, `api.get('/api/fatture')`, `api.get('/api/pagamenti?year='+y)`. Se scenario `needsConfig` → `renderNeedsConfig`. Calcola `effectiveRate` dallo scenario, chiama `computeAccantonamento`, `renderCumulativeChart`, compone con `renderTasse`. Errori → messaggio sobrio (come regime).

- [ ] **Step 1: leggere** `pages/regime.ts` (pattern + `eur`) e `lib/api.ts`.
- [ ] **Step 2: failing test** sulle funzioni pure: `renderStatus` con gap>0 mostra warn + euro; `renderTable` mostra le righe + totale; `renderDeferred` vuoto → nota; `renderNeedsConfig` → CTA.
- [ ] **Step 3: run fail**
- [ ] **Step 4: implementare** funzioni pure + `mount`.
- [ ] **Step 5: run pass** (test pure); `npm run typecheck`.
- [ ] **Step 6: commit** `feat(client): pagina Tasse Accantonate (render + mount)`

---

### Task 4: Routing (`main.ts`)

- [ ] **Step 1:** in `main.ts`: `'/tasse': () => import('./pages/tasse')` (sostituisce placeholder).
- [ ] **Step 2:** `npm run typecheck && npm run build` → OK.
- [ ] **Step 3: commit** `feat(client): route /tasse → pagina Tasse Accantonate`

---

### Task 5: Stili (`styles/components.css`)

- [ ] **Step 1:** stili per status box (ok/warn), tabella, grafico wrapper, tabella differite (riusare `.card`/token, responsive <600px).
- [ ] **Step 2:** `npm run build` → OK.
- [ ] **Step 3: commit** `style(client): stili pagina Tasse Accantonate`

---

### Task 6: Verifica finale

- [ ] `npm run typecheck && npm test && npm run build` → verde (flakiness Windows nota; rilanciare singolo file se fallimento isolato).

---

## Self-Review

**Spec coverage:** % effettiva da scenario→T3; status maturato/versato/gap→T1+T3; tabella per-fattura→T1+T3; grafico cumulato→T2+T3; differite→T1+T3; needsConfig→T3; routing→T4; stili→T5. ✓ Frontend-only, nessun backend. ✓
**Note:** `effectiveRate` coerente con la "% effettiva" del Regime. Nessuna logica fiscale nuova (solo applicazione di un rate ai lordi). `clienteSnapshot` è JSON string → parse difensivo. Riusare `eur`/`esc`/`mountPage`/`getYear`/`api`.
