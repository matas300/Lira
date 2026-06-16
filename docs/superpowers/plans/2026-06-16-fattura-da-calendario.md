# Crea fattura dal calendario (Slice B) — Spec + Implementation Plan

> Eseguire task-by-task in TDD, commit frequenti.

**Goal:** Bottone "Da calendario" sulla pagina Fatture → picker dei mesi (mostra giorni lavorati + mezze giornate dal calendario, e una tariffa giornaliera) → scelto un mese, apre il modal di creazione fattura **precompilato** con le righe (giornate intere: qtà = giorni × tariffa; mezze: qtà × tariffa/2) e il cliente di default. Replica la feature amata di CalcoliVari.

**Architecture:** La tariffa giornaliera è un setting per-anno (in CalcoliVari `dailyRate`; l'import l'ha scartata). Aggiungerla a `year_settings` (colonna nullable + migration + schema + GET/PUT + mapping importer). Frontend: helper PURO che conta giorni lavorati/mezzi per mese (da calendar entries + default), e l'integrazione nel `pages/fatture.ts` (bottone + picker modal + prefill del modal esistente).

**Tech Stack:** Drizzle (migration), Hono, vanilla TS, Zod, `node --test`.

**Dipende da:** Slice A (route calendario + `lib/calendar-defaults.ts`) già mergiato.

---

### Task 1: `tariffa_giornaliera` su year_settings (backend)

**Files:** Modify `src/server/db/schema.ts`, `src/shared/schemas.ts`, `src/server/lib/import-calcolivari/map.ts`; generate migration in `drizzle/`; Test estende `src/server/routes/year-settings.test.ts`

- [ ] **Step 1: leggere** `src/server/db/schema.ts` (tabella `yearSettings`), `src/shared/schemas.ts` (`YearSettingsInput`), `src/server/routes/year-settings.ts` (GET/PUT, come serializza), `src/server/lib/import-calcolivari/map.ts` (mapping yearSettings ~righe 67-79), e `drizzle.config.ts` + `package.json` (`db:generate`).
- [ ] **Step 2: failing test** in `year-settings.test.ts`: PUT con `tariffaGiornaliera: 250` su un anno valido → 200; GET dello stesso anno → `yearSettings.tariffaGiornaliera === 250`. (Aggiungere il campo al body di un PUT esistente nel test.)
- [ ] **Step 3: implementare**:
  - `schema.ts`: aggiungere `tariffaGiornaliera: real('tariffa_giornaliera')` (nullable) a `yearSettings`.
  - `shared/schemas.ts`: aggiungere `tariffaGiornaliera: z.number().nonnegative().nullable().optional()` a `YearSettingsInput`; includerlo nel tipo/serializzazione del GET (la route ritorna la riga — verificare che il nuovo campo passi).
  - `year-settings.ts`: assicurarsi che PUT scriva e GET ritorni il campo (se mappa esplicitamente i campi, aggiungerlo).
  - `import-calcolivari/map.ts`: nel mapping yearSettings, `tariffaGiornaliera: nn(s['dailyRate'])` (riusa l'helper `nn`).
  - generare la migration: `npm run db:generate` (crea il file SQL in `drizzle/`). NON modificare migration esistenti.
- [ ] **Step 4: run** `npx tsx --test src/server/routes/year-settings.test.ts` → pass; `npm run typecheck`.
- [ ] **Step 5: commit** `feat(year-settings): campo tariffa_giornaliera (+ migration, mapping import)`

---

### Task 2: Statistiche giornate per mese (`src/client/lib/calendar-stats.ts`)

**Files:** Create `src/client/lib/calendar-stats.ts`; Test `calendar-stats.test.ts`

Puro: dato l'anno + la mappa override (`Map<"month-day", code>`), per ogni mese conta `worked` (effectiveCode === '8') e `half` (=== 'M'), usando `getDefaultActivity` (da `lib/calendar-defaults.ts`) per i giorni senza override.

```ts
export interface MonthStat { month: number; worked: number; half: number; }
export function monthlyWorkStats(year: number, overrides: Map<string,string>): MonthStat[]; // 12 elementi
```

- [ ] **Step 1: failing test** — anno 2025, mappa con qualche override (es. 2 giorni '8'→'F' tolgono 2 lavorati; un '8'→'M' sposta 1 a half). Verifica worked/half di un mese. Mese senza override → worked = giorni feriali non festivi del mese.
- [ ] **Step 2: run fail**
- [ ] **Step 3: implementare** (itera i giorni del mese, `effectiveCode = overrides.get("m-d") ?? getDefaultActivity(...)`, conta).
- [ ] **Step 4: run pass**
- [ ] **Step 5: commit** `feat(client): statistiche giornate lavorate per mese (calendar-stats.ts)`

---

### Task 3: Flusso "Da calendario" nelle Fatture (`src/client/pages/fatture.ts`)

**Files:** Modify `src/client/pages/fatture.ts`

- [ ] **Step 1: leggere** `pages/fatture.ts` per intero: come apre il modal di creazione (funzione tipo `openCreateModal`/`renderFatturaModal`), la struttura del draft (clienteId, data, righe[]), come si seleziona il cliente default, come fa fetch (api), e dove sta il pulsante "Nuova fattura" (header). Leggere `lib/calendar-stats.ts` (Task 2), `lib/year.ts`, `lib/api`, `components/modal.ts`.
- [ ] **Step 2: implementare** (no unit test — è wiring DOM su modal esistente; verifica via typecheck+build):
  - Aggiungere un bottone **"Da calendario"** vicino a "Nuova fattura" nell'header delle fatture.
  - Click → carica in parallelo: `GET /api/calendario/${year}` (override → mappa) e `GET /api/year-settings/${year}` (per `tariffaGiornaliera`). Calcola `monthlyWorkStats`.
  - Aprire un **picker modal** (riusare `openModal`/pattern di `promptPayModal` se utile): campo **tariffa** (prefill da settings, editabile, richiesto) + lista 12 mesi con "Mese · N gg + M mezze · €(gg×t + M×t/2)"; mesi con 0 giorni disabilitati. (Ricalcolo importi quando la tariffa cambia.)
  - Selezionato un mese: chiudere il picker e **aprire il modal di creazione fattura esistente** precompilato:
    - cliente = default (isDefault) se presente,
    - `data` = ultimo giorno del mese scelto (o oggi),
    - righe: se gg>0 `{ descrizione:"Consulenza {Mese} {anno} — giornate intere", quantita: gg, prezzoUnitario: tariffa }`; se mezze>0 `{ descrizione:"... — mezze giornate", quantita: mezze, prezzoUnitario: tariffa/2 }`.
    L'utente può ancora modificare tutto prima di salvare (riusa il flusso/submit esistente del modal → `POST /api/fatture`).
  - Persistenza tariffa: se l'anno ha year-settings, dopo l'uso fare `PUT /api/year-settings/${year}` con i settings correnti + `tariffaGiornaliera` aggiornata (load current da GET, merge, PUT), così è ricordata. Se non esistono settings, usare la tariffa solo in modo transitorio (nessun PUT).
  - Errori (rete / niente cliente / tariffa mancante) → messaggio sobrio, non bloccante.
- [ ] **Step 3: typecheck + build** `npm run typecheck && npm run build` → OK.
- [ ] **Step 4: commit** `feat(client): crea fattura dal calendario (picker mese → prefill modal)`

---

### Task 4: Stili picker (`src/client/styles/components.css`)

**Files:** Modify `src/client/styles/components.css`

- [ ] **Step 1: aggiungere** stili per il picker mesi (griglia bottoni mese con conteggi + importo, campo tariffa, stato disabilitato). Riusare token/classi modal esistenti. Responsive.
- [ ] **Step 2: build** → OK.
- [ ] **Step 3: commit** `style(client): stili picker fattura-da-calendario`

---

### Task 5: Verifica finale

- [ ] `npm run typecheck && npm test && npm run build` → verde (flakiness Windows nota; rilanciare singolo file se fallimento isolato). Verificare che la migration sia inclusa e che i test (che girano le migration) passino.

---

## Self-Review

**Spec coverage:** tariffa su year_settings + migration + import map→T1; conteggio giorni/mese→T2; bottone+picker+prefill modal+persist tariffa→T3; stili→T4; verifica→T5. ✓
**Note:**
- La migration è additiva (colonna nullable) → non rompe i dati esistenti; gli utenti importati hanno `tariffaGiornaliera` null finché non la impostano nel picker (che la persiste su year-settings). NB: il `dailyRate` originale di CalcoliVari NON è nel DB Lira (scartato all'import); resta in Firestore se in futuro si vuole fare backfill — fuori scope qui.
- Riusare il modal di creazione fattura ESISTENTE (non duplicarlo): il flusso da-calendario lo apre solo precompilato.
- `monthlyWorkStats` riusa `getDefaultActivity` di Slice A (DRY).
