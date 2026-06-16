# Regime Forfettario (Completo) — Spec + Implementation Plan

> **For agentic workers:** eseguire task-by-task in TDD, commit frequenti. Checkbox `- [ ]` per il tracking.

**Goal:** Pagina "Regime Forfettario" (home `/`) che mostra la posizione fiscale reale dell'anno selezionato — donut ripartizione, sintesi netto, barra limite 85k, tabella mensile, formula base fiscale, confronto storico vs previsionale, warning, breakdown INPS, cash. Dati reali dal DB.

**Architecture:** Il motore (`tax-engine.ts`) è già completo (`buildForfettarioMethodComparison`). Aggiungiamo un endpoint `GET /api/tax/scenario` che legge i dati reali (fatture, pagamenti, year-settings, anno precedente) e chiama il motore. Il frontend porta la pagina da CalcoliVari (`app-calcolo.js`, `app-charts.js`) consumando l'endpoint. Parametri in sola lettura (editor in slice futuro).

**Tech Stack:** Hono + Drizzle (backend), vanilla TS + Vite (frontend), Zod, `node --test`.

---

## Contratto endpoint (sorgente di verità condivisa BE↔FE)

`GET /api/tax/scenario?year=YYYY` (auth: requireSession; profilo da sessione)

Se year-settings dell'anno NON esistono:
```json
{ "year": 2026, "needsConfig": true }
```

Altrimenti:
```json
{
  "year": 2026,
  "needsConfig": false,
  "grossCollected": 50000,
  "limite": 85000,
  "comparison": { /* ComparisonOutput dal motore: selectedMethod, historical, previsionale, prudential, liquidity, warnings */ },
  "monthly": [ { "month": 1, "lordo": 3000, "netto": 1900, "tasseContrib": 1100, "fonte": "Fattura" }, ... ]
}
```

Lo scenario "selezionato" per donut/sintesi = `comparison[comparison.selectedMethod]` (historical|previsionale).

**Derivazioni note (per il FE, niente nuovi campi BE):**
- netto annuo = `grossCollected − selected.substituteTax − selected.deductibleContributionsPaid`
- INPS totale = `selected.deductibleContributionsPaid`
- imposta = `selected.substituteTax`
- % effettiva = `(substituteTax + deductibleContributionsPaid) / grossCollected`

---

## File structure

- Modify: `src/server/routes/tax.ts` (aggiunge GET `/scenario`)
- Create: `src/server/lib/scenario-data.ts` (legge DB → `ScenarioInput`/`ComparisonInput`; isola le query dal route)
- Test: `src/server/routes/tax.test.ts` (estende) o nuovo `src/server/lib/scenario-data.test.ts`
- Create: `src/client/pages/regime.ts` (pagina)
- Create: `src/client/components/donut.ts` (SVG donut, port drawDonut)
- Modify: `src/client/main.ts` (`/` → `./pages/regime` invece di placeholder)
- Modify: `src/client/styles/components.css` (stili pagina regime)
- Test: `src/client/components/donut.test.ts`, `src/client/pages/regime.test.ts` (solo funzioni di render pure)

---

### Task 1: Lettura dati reali per lo scenario (`lib/scenario-data.ts`)

**Files:** Create `src/server/lib/scenario-data.ts`; Test `src/server/lib/scenario-data.test.ts`

**Responsabilità:** data una `db`, `profileId`, `year`, costruire l'input per `buildForfettarioMethodComparison` leggendo:
- year-settings dell'anno (coefficiente, impostaSostitutiva, inpsMode, inpsCategoria, riduzione35, scadenziarioMetodo). Se assenti → ritorna `null` (il route risponderà needsConfig).
- `grossCollected` = somma `fatture.importo` dell'anno effettivamente incassate (stato pagata/incassata, `pagAnno = year`); più il breakdown per `pagMese`.
- acconti reali pagati: somma `pagamenti.importo` per `scheduleKey` di acconto imposta/contributi dell'anno; contributi versati dell'anno.
- anno precedente: `grossCollected(year-1)` → uno scenario base (prior-year con i suoi prev azzerati, approssimazione bounded) per ricavare `previousTaxBase` e `previousContribution.saldoAccontoBase`; in alternativa usare i campi `primoAnno*` di year-settings se presenti (primo anno su Lira).

**Interfaccia esportata:**
```ts
export interface ScenarioData {
  grossCollected: number;
  monthly: { month: number; lordo: number }[]; // lordo incassato per mese
  comparisonInput: ComparisonInput; // pronto per buildForfettarioMethodComparison
}
export async function loadScenarioData(db: Db, profileId: string, year: number): Promise<ScenarioData | null>;
```
(`null` ⇒ year-settings mancanti.)

- [ ] **Step 1: leggere i pattern esistenti.** Aprire `src/server/routes/fatture.ts`, `src/server/routes/pagamenti.ts`, `src/server/routes/year-settings.ts`, `src/server/db/schema.ts` (tabelle `fatture`, `pagamenti`, `yearSettings`) e `src/server/lib/tax-engine.ts` (firme `ScenarioInput`, `ComparisonInput`, `buildForfettarioMethodComparison`, `calcContributiVariabili*`). Capire: come si filtra per profileId/anno, i nomi colonna (`pagAnno`, `pagMese`, `stato`, `scheduleKey`, `tipo`), gli scheduleKey degli acconti.

- [ ] **Step 2: Write failing test** (`scenario-data.test.ts`)

Usare l'helper DB di test esistente (`src/server/db/test-helper.ts`, vedi `import-calcolivari/*.test.ts` per l'uso) per creare un profilo, seedare year-settings + alcune fatture incassate (2 mesi) + un pagamento di acconto, poi:
```ts
const data = await loadScenarioData(db, profileId, 2025);
assert.ok(data);
assert.equal(data!.grossCollected, /* somma fatture incassate 2025 */);
assert.equal(data!.monthly.length >= 1, true);
assert.equal(typeof data!.comparisonInput.grossCollected, 'number');
// year-settings assenti → null
assert.equal(await loadScenarioData(db, profileId, 1999), null);
```
Definire i numeri attesi in base al seed.

- [ ] **Step 3: Run test (fail).** `npx tsx --test src/server/lib/scenario-data.test.ts` → FAIL (modulo assente).

- [ ] **Step 4: Implementare** `scenario-data.ts` seguendo i pattern letti allo Step 1. Mantenere il file focalizzato sulle sole query + assemblaggio input. Niente logica fiscale (sta nel motore).

- [ ] **Step 5: Run test (pass).**

- [ ] **Step 6: Commit** `feat(tax): lettura dati reali DB per scenario forfettario (scenario-data.ts)`

---

### Task 2: Endpoint `GET /api/tax/scenario` (`routes/tax.ts`)

**Files:** Modify `src/server/routes/tax.ts`; Test estende `src/server/routes/tax.test.ts`

- [ ] **Step 1: Write failing test.** Nel test del route (vedi pattern esistente in `tax.test.ts`): seed profilo+settings+fatture, `GET /api/tax/scenario?year=2025` → 200 con `{ needsConfig:false, grossCollected, comparison, monthly, limite:85000 }`; anno senza settings → `{ needsConfig:true }`. Verifica che `comparison.historical` e `comparison.previsionale` esistano.

- [ ] **Step 2: Run (fail).**

- [ ] **Step 3: Implementare** l'handler: legge `year` (default anno corrente, valida come fa `/rules`), profileId da sessione, chiama `loadScenarioData`; se `null` → `{ year, needsConfig:true }`; altrimenti `buildForfettarioMethodComparison(data.comparisonInput)`, calcola `monthly` con netto/tasse proporzionali al rapporto annuo, e risponde col contratto sopra. `limite` da `FORFETTARIO_RULES.sogliaIngresso` (vedi `/rules`).

- [ ] **Step 4: Run (pass).**

- [ ] **Step 5: Commit** `feat(tax): GET /api/tax/scenario (scenario reale + comparison + mensile)`

---

### Task 3: Componente donut SVG (`components/donut.ts`)

**Files:** Create `src/client/components/donut.ts`; Test `src/client/components/donut.test.ts`

**Port da** `CalcoliVari/app-charts.js` `drawDonut(netto, tasse, contributi)`. Funzione pura → ritorna stringa SVG.

- [ ] **Step 1: Write failing test.** `renderDonut({ netto:1900, imposta:600, inps:500 })` ritorna stringa che contiene `<svg`, 3 segmenti (`<circle`/`<path`), e la % netto al centro (`48%` ca.). Valori a 0 → nessun crash.

- [ ] **Step 2: Run (fail).**

- [ ] **Step 3: Implementare** `renderDonut(parts: { netto:number; imposta:number; inps:number }): string` portando la matematica del donut da `app-charts.js` (archi proporzionali, colori dai token: netto `--color-primary`, imposta `--color-tertiary`, inps `--color-secondary`). Pura, niente DOM.

- [ ] **Step 4: Run (pass).**

- [ ] **Step 5: Commit** `feat(client): componente donut SVG (port drawDonut)`

---

### Task 4: Funzioni di render della pagina (`pages/regime.ts` — parti pure)

**Files:** Create `src/client/pages/regime.ts`; Test `src/client/pages/regime.test.ts`

**Nota:** la pagina usa `mountPage` (DOM) per il montaggio, ma le funzioni che formattano i blocchi devono essere **pure** (ricevono i dati dell'endpoint, ritornano HTML string) per essere testabili senza DOM. Esportarle.

- [ ] **Step 1: Write failing test** per le funzioni pure, es.:
```ts
import { renderSintesi, renderMonthlyTable, renderLimitBar, renderComparison } from './regime';
```
- `renderSintesi(selected, grossCollected)` contiene "Netto", l'euro netto, imposta e INPS.
- `renderLimitBar(grossCollected, limite)` contiene la % e gestisce >100% (decadenza).
- `renderMonthlyTable(monthly)` ha 12 righe o quante presenti, con i mesi.
- `renderComparison(comparison)` mostra storico vs previsionale e i warning.
- `needsConfig` → `renderNeedsConfig(year)` mostra la CTA "Configura".

- [ ] **Step 2: Run (fail).**

- [ ] **Step 3: Implementare** le funzioni pure di render in `regime.ts` (usare `esc()` per ogni valore dinamico; formattazione euro coerente con clienti/fatture — controllare un helper di formato esistente in `lib/` o nelle pagine, riusarlo). Layout/sezioni come la pagina "Calcolo"+"Riepilogo" di CalcoliVari (donut, sintesi, limite, tabella mensile, formula, confronto, warning, INPS, cash).

- [ ] **Step 4: Run (pass).**

- [ ] **Step 5: Commit** `feat(client): funzioni di render pagina Regime Forfettario`

---

### Task 5: Montaggio pagina + routing + fetch (`pages/regime.ts` mount, `main.ts`)

**Files:** Modify `src/client/pages/regime.ts` (aggiunge `mount`); Modify `src/client/main.ts`

- [ ] **Step 1: Implementare `mount`** con `mountPage({ route:'/', render })`: dentro `render`, leggere l'anno da `getYear()`, `fetch('/api/tax/scenario?year='+year)` (usare il wrapper `lib/api.ts`), gestire `needsConfig`, comporre la pagina con le funzioni pure del Task 4 + `renderDonut`. Errori di rete → messaggio sobrio.

- [ ] **Step 2: Routing.** In `main.ts` cambiare `'/': () => import('./pages/placeholder')` → `'/': () => import('./pages/regime')`.

- [ ] **Step 3: Typecheck + build.** `npm run typecheck && npm run build` → OK.

- [ ] **Step 4: Commit** `feat(client): pagina Regime Forfettario su / (sostituisce placeholder)`

---

### Task 6: Stili pagina (`styles/components.css`)

**Files:** Modify `src/client/styles/components.css`

- [ ] **Step 1: Aggiungere** gli stili per le sezioni della pagina regime (card panel, griglia, donut wrapper, barra limite, tabella mensile, righe sintesi positive/negative, pannello warning), riusando i token e le classi `.card` esistenti. Coerenti col dark theme.

- [ ] **Step 2: Build.** `npm run build` → OK.

- [ ] **Step 3: Commit** `style(client): stili pagina Regime Forfettario`

---

### Task 7: Verifica finale

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build` → tutto verde (nota: flakiness Windows nota su test paralleli; rilanciare il singolo file se un fallimento isolato).
- [ ] **Step 2:** Nessun commit extra se già tutto committato nei task precedenti.

---

## Self-Review

**Spec coverage:** donut→T3/T4; sintesi→T4; barra limite→T2(limite)+T4; tabella mensile→T2(monthly)+T4; formula/comparison/warning/INPS/cash→T2(comparison)+T4; fatturato auto→T1; parametri sola lettura + needsConfig→T1/T2/T4; routing→T5; stili→T6. ✓

**Note implementative chiave:**
- `buildForfettarioMethodComparison` e `ComparisonInput`/`ScenarioInput` sono già in `tax-engine.ts` — NON reimplementare, solo alimentare.
- Anno precedente: usare i campi `primoAnno*` di year-settings se valorizzati, altrimenti scenario base su fatture(anno-1). Se l'anno-1 non ha settings, usare i default del motore (acconti storico potranno risultare 0 — accettabile).
- Cash perspective: derivata dai campi già presenti nello scenario (`managedCashOutflows`, `taxAcconti`, `contributionAcconti`, `previousFixedTail`, `currentFixedWithinYear`) — niente dipendenza da scadenziario.
- Formato euro: riusare l'helper esistente del progetto (cercarlo prima di crearne uno).
