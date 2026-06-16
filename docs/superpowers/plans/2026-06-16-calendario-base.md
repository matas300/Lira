# Calendario base (Slice A) — Spec + Implementation Plan

> Eseguire task-by-task in TDD, commit frequenti.

**Goal:** Pagina "Calendario" (`/calendario`): griglia 12 mesi dell'anno selezionato dove si marcano i giorni con codici attività (lavoro/mezza/ferie/festivo/malattia/donazione/WE), con conteggi per mese+anno e legenda. Modifica via click→picker. Backend: GET + PUT/DELETE entries (oggi la tabella `calendar_entries` esiste con dati importati ma NON ha route).

**Architecture:** Nuovo route `calendario` (GET lista anno, PUT upsert giorno, DELETE giorno) + Zod schema condiviso. Frontend: default-day logic PURA (`lib/calendar-defaults.ts`, festività IT + weekend), pagina `pages/calendario.ts` (render puro + mount con fetch + edit). Solo gli override (codici ≠ default) vivono nel DB; il default è calcolato client-side.

**Tech Stack:** Hono + Drizzle, vanilla TS + Vite, Zod, `node --test`.

**Scope NOTE:** la creazione-fattura-dal-calendario è lo Slice B separato (richiede `tariffa_giornaliera` su year_settings) — NON in questo slice.

---

## Codici attività

`'8'` Lavoro · `'M'` Mezza giornata · `'F'` Ferie · `'FS'` Festivo · `'Malattia'` Malattia · `'Donazione'` Donazione · `'WE'` Weekend.
Default per giorno (calcolato, non salvato): sab/dom → `'WE'`; festività nazionale IT → `'FS'`; altrimenti → `'8'`. Si salva una entry SOLO quando il codice scelto ≠ default; tornare al default → DELETE.

---

## Contratti API (nuovi)

- `GET /api/calendario/:year` (auth; profilo da sessione) → `{ year, entries: { month, day, activityCode }[] }`. 400 INVALID_YEAR.
- `PUT /api/calendario/:year/:month/:day` body `{ activityCode }` → upsert riga (PK `profileId,year,month,day`). Valida code ∈ set; month 1-12, day 1-31. → `{ ok:true, entry }`.
- `DELETE /api/calendario/:year/:month/:day` → `{ ok:true }` (rimuove l'override; idempotente).

---

## File structure

- Modify: `src/shared/schemas.ts` (ActivityCodeEnum + CalendarEntryInput)
- Create: `src/server/routes/calendario.ts` + register in `src/server/index.ts`
- Test: `src/server/routes/calendario.test.ts`
- Create: `src/client/lib/calendar-defaults.ts` + test
- Create: `src/client/pages/calendario.ts` + test
- Modify: `src/client/main.ts` (`/calendario` → page)
- Modify: `src/client/styles/components.css`

---

### Task 1: Schema condiviso (`src/shared/schemas.ts`)

**Files:** Modify `src/shared/schemas.ts`; Test inline nel route test (Task 3).

- [ ] **Step 1: leggere** `src/shared/schemas.ts` per lo stile (enum/oggetti Zod esistenti, es. PagamentoTipoEnum).
- [ ] **Step 2: aggiungere**:
```ts
export const ActivityCodeEnum = z.enum(['8','M','F','FS','Malattia','Donazione','WE']);
export const CalendarEntryInput = z.object({ activityCode: ActivityCodeEnum });
export type CalendarEntryInputT = z.infer<typeof CalendarEntryInput>;
```
- [ ] **Step 3: typecheck** `npm run typecheck` → OK.
- [ ] **Step 4: commit** `feat(shared): schema activity code calendario`

---

### Task 2: Default giorno (`src/client/lib/calendar-defaults.ts`)

**Files:** Create `src/client/lib/calendar-defaults.ts`; Test `calendar-defaults.test.ts`

Porta `getDefaultActivity` da CalcoliVari (`app.js` ~riga 840) + la lista festività IT. Festività fisse: 1/1, 6/1, 25/4, 1/5, 2/6, 15/8, 1/11, 8/12, 25/12, 26/12. Festività mobile: **Pasquetta** (lunedì dopo Pasqua) — calcolare Pasqua con l'algoritmo di Gauss/Meeus per l'anno.

```ts
export function getDefaultActivity(year: number, month: number, day: number): '8'|'WE'|'FS';
export function isItalianHoliday(year: number, month: number, day: number): boolean;
```
- weekend (sab/dom) → `'WE'` (precede il check festività? in CalcoliVari WE ha priorità — verificare nel sorgente e replicare l'ordine esatto).

- [ ] **Step 1: leggere** `CalcoliVari/app.js` `getDefaultActivity` per replicare ESATTAMENTE ordine e festività.
- [ ] **Step 2: failing test** — 1/1 (festivo) → 'FS' o 'WE' se cade di weekend (replica l'ordine CalcoliVari); un sabato feriale → 'WE'; un mercoledì qualsiasi → '8'; Pasquetta 2025 (21/4/2025) → 'FS'; 25/12 → 'FS' (o WE se weekend). Definire gli attesi dopo aver letto il sorgente.
- [ ] **Step 3: run fail** `npx tsx --test src/client/lib/calendar-defaults.test.ts`
- [ ] **Step 4: implementare** (puro; Easter via Gauss).
- [ ] **Step 5: run pass**
- [ ] **Step 6: commit** `feat(client): default attività giorno + festività IT (calendar-defaults.ts)`

---

### Task 3: Route calendario (`src/server/routes/calendario.ts`)

**Files:** Create `src/server/routes/calendario.ts`; Modify `src/server/index.ts` (montare la route sotto `/api/calendario`); Test `src/server/routes/calendario.test.ts`

- [ ] **Step 1: leggere** un route esistente con :param + body validation (es. `src/server/routes/year-settings.ts` per GET/PUT `:year` + zJson, e come si ottiene `activeProfileId` da sessione; `src/server/db/schema.ts` tabella `calendarEntries`; `src/server/index.ts` per il montaggio route).
- [ ] **Step 2: failing test** (pattern da `year-settings.test.ts`): seed profilo; PUT `/api/calendario/2025/3/10` `{activityCode:'F'}` → 200; GET `/api/calendario/2025` → entries contiene `{month:3,day:10,activityCode:'F'}`; DELETE `/api/calendario/2025/3/10` → GET non la contiene più; PUT con code invalido → 400; anno invalido → 400.
- [ ] **Step 3: run fail**
- [ ] **Step 4: implementare** GET (select where profileId+year), PUT (upsert: insert ... onConflict update su PK, set activityCode+updatedAt), DELETE (delete where PK). Montare in `index.ts`. Validare year/month/day e body con Zod.
- [ ] **Step 5: run pass** + `npm run typecheck`
- [ ] **Step 6: commit** `feat(api): route calendario GET/PUT/DELETE entries`

---

### Task 4: Funzioni di render pure (`src/client/pages/calendario.ts`)

**Files:** Create `src/client/pages/calendario.ts`; Test `calendario.test.ts`

Funzioni pure esportate:
- `effectiveCode(entriesMap, year, month, day)` → override se presente, altrimenti `getDefaultActivity(...)`.
- `renderMonth(year, month, entriesMap, today)` → card mese: header (nome mese), riga giorni settimana (L M M G V S D), griglia giorni con celle `class="cal-day act-{code}"` (+ `today`), summary conteggi (X lav, Y mezze, WE, ferie, festivi, malattia, donazione — solo non-zero). Ogni cella ha `data-month`/`data-day` per il click.
- `renderLegend()` → legenda codici→colore→label.
- `renderCalendario(year, entriesMap, today)` → legenda + 12 `renderMonth`.
(entriesMap = `Map<"month-day", activityCode>` costruita dal fetch.)

- [ ] **Step 1: leggere** `pages/regime.ts` (stile, `esc`, mountPage) e `CalcoliVari/app-calendar.js` `renderCalendario` per la struttura griglia (offset primo giorno = lunedì, ecc.).
- [ ] **Step 2: failing test**: `renderMonth(2025, 1, mapVuota, today)` ha 31 celle giorno + header "Gennaio"; un giorno con override 'F' ha classe `act-F`; il summary conta i lavorativi; `renderLegend` contiene tutti i codici.
- [ ] **Step 3: run fail**
- [ ] **Step 4: implementare** (puro; offset settimana lunedì-based; `esc` su dinamici).
- [ ] **Step 5: run pass**
- [ ] **Step 6: commit** `feat(client): render calendario (griglia mesi + legenda)`

---

### Task 5: Mount + picker + routing (`calendario.ts` mount, `main.ts`)

**Files:** Modify `src/client/pages/calendario.ts` (mount); Modify `src/client/main.ts`

- [ ] **Step 1: implementare `mount`** (`mountPage({route:'/calendario'})`): legge `getYear()`, `GET /api/calendario/${year}` → costruisce entriesMap, `today = new Date().toISOString().slice(0,10)`, render con `renderCalendario`. Click su una cella giorno (`[data-day]`) → popup picker (lista codici, evidenzia corrente): scelta `code` → se `code === getDefaultActivity(...)` allora `DELETE /api/calendario/:y/:m/:d` altrimenti `PUT ... {activityCode:code}`; poi aggiorna la mappa e ri-renderizza (o `ctx.rerender()`). Errori → messaggio sobrio.
- [ ] **Step 2: routing** — `main.ts`: `'/calendario': () => import('./pages/calendario')`.
- [ ] **Step 3: typecheck + build** → OK.
- [ ] **Step 4: commit** `feat(client): pagina Calendario su /calendario (fetch + edit giorni)`

---

### Task 6: Stili (`styles/components.css`)

**Files:** Modify `src/client/styles/components.css`

- [ ] **Step 1: aggiungere** stili: griglia mesi responsive (più colonne su desktop, 1 su mobile), `.cal-day` celle, colori `.act-8/.act-M/.act-F/.act-FS/.act-Malattia/.act-Donazione/.act-WE` (dai token: lavoro neutro, ferie primary, festivo secondary, malattia error, ecc.), `.today`, popup picker, legenda, summary. Coerente dark theme.
- [ ] **Step 2: build** → OK.
- [ ] **Step 3: commit** `style(client): stili pagina Calendario`

---

### Task 7: Verifica finale

- [ ] `npm run typecheck && npm test && npm run build` → verde (flakiness Windows nota; rilanciare singolo file se fallimento isolato).

---

## Self-Review

**Spec coverage:** schema→T1; default+festività→T2; route GET/PUT/DELETE→T3; render griglia+legenda+conteggi→T4; mount+picker+routing→T5; stili→T6. ✓ Creazione-fattura-da-calendario esclusa (Slice B). ✓
**Note:** solo override nel DB, default calcolato client-side (coerente con CalcoliVari sparse storage). Replicare ESATTAMENTE l'ordine WE-vs-festività di CalcoliVari. Easter via Gauss per Pasquetta. Riusare `esc`/`mountPage`/`getYear`/`api`.
