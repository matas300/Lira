# Budget — Design (Slice frontend)

Data: 2026-06-17
Stato: approvato (in attesa di piano di implementazione)

## Obiettivo

Implementare la pagina **`/budget`** (oggi `placeholder`), portando fedelmente la
feature Budget di CalcoliVari (`app-budget.js`) nel modello dati per-anno già
presente in Lira. Il Budget alloca un **netto mensile** in voci di spesa, con
selettore del mese di riferimento, voci ad importo fisso / percentuale / "auto"
(splitta il rimanente in parti uguali), totali e barra di distribuzione.

## Decisioni di scoping (risolte in brainstorming)

1. **Netto mensile = selettore mese** (replica CalcoliVari), non solo media annuale.
2. **Scope del selettore = solo anno visualizzato**: il budget dell'anno X usa come
   base un mese dell'anno X, o la media annuale di X. Una sola fetch scenario,
   aliquota effettiva coerente. È l'adattamento naturale allo schema per-anno già
   committato (in CalcoliVari il budget era globale e cross-anno).
3. **Migration 0004** su `year_settings` per persistere il base month.
4. **Auto-save debounced** (PUT replace), non bottone "Salva" esplicito — rispecchia
   il `saveData()` istantaneo di CalcoliVari.

## Comportamento

Pagina `/budget`, year-scoped via `getYear()`.

### Selettore base (mese di riferimento)
- Dropdown dei mesi dell'anno visualizzato che hanno fatture **pagate** (`pagAnno === year`,
  `pagMese` valorizzato, `stato !== 'bozza'`), ognuno con il lordo del mese.
- Opzione default **"Auto (ultima)"** (`baseMonth = null`).

Modalità di calcolo del netto mensile:
- **manuale** (`baseMonth = M`): `lordo(M) × (1 − rate)`.
- **auto** (`baseMonth = null`) e ci sono fatture: ultimo mese con fatture →
  `lordo(ultimo) × (1 − rate)`. `source = 'auto'`.
- **media** (`baseMonth = null`) e nessuna fattura nell'anno: `nettoAnnuo / 12`.
  `source = 'media'`.

Dove `rate` = aliquota effettiva dell'anno = `(impostaSostitutiva + INPS) / grossCollected`,
presa da `/api/tax/scenario?year=` (stessa formula di `tasse.ts`/`regime.ts`).
`nettoAnnuo` arriva dallo stesso endpoint.

### Lordo per mese
Aggregazione separata da `accantonamento.ts` (che clampa i negativi a 0): per il
budget servono le note di credito come **negative**. Per ogni fattura con
`pagAnno === year`, `pagMese` ∈ [1..12], `stato !== 'bozza'`:
`val = (importo − ritenuta)`, negato se `tipoDocumento === 'TD04'` (nota di credito).
Sommare per `pagMese`. Mostrare nel dropdown solo i mesi con totale > 0.
(Verificare in implementazione il segno con cui Lira memorizza l'`importo` delle NC.)

### Voci di budget
Tabella a 5 colonne (port da CalcoliVari `budget-row-5`):
- **nome** (input testo, placeholder "es. Affitto, Cibo…")
- **importo** (€, input number)
- **%** (input number, comodità: setta `importo = ceil2(nettoMensile × pct / 100)`)
- **auto** (checkbox: se attivo, `importo = 0` e la voce riceve quota del rimanente)
- **elimina** (×)
- Bottone "+ Aggiungi voce".

**Auto-split**: le voci con `auto = true` e nessun `importo` manuale (> 0) si
dividono equamente `(nettoMensile − totManuale)` (se positivo). Calcolato a
render-time, **non persistito** (si persiste `auto = true`, `importo = 0`).

### Totali e distribuzione
- Riga "Totale voci" e "Rimanente" (`nettoMensile − totBudget`; verde se ≥ 0).
- Barra orizzontale segmentata + legenda con colori, percentuali e segmento
  "Rimanente". Port da CalcoliVari (riuso variabili CSS dei token Lira).

## Persistenza

`budget_items` (già in `schema.ts`):
`id, profileId, year, nome, importo, auto, ordine, createdAt, updatedAt`.

**Migration 0004**: aggiunge a `year_settings`:
- `budget_base_month INTEGER` (nullable). `null` = auto/media; `1..12` = mese manuale.

Base year non serve come colonna: è sempre l'anno visualizzato.

## API

Server autoritativo per i dati del budget e per l'aliquota (via scenario).

- `GET /api/budget?year=<n>` →
  `{ baseMonth: number | null, items: BudgetItem[] }`
  (items ordinati per `ordine`).
- `PUT /api/budget?year=<n>` body
  `{ baseMonth: number | null, items: Array<{ nome, importo, auto, ordine }> }`
  → **replace atomico**: cancella le `budget_items` dell'anno e reinserisce quelle
  fornite (nuovi `id` generati server-side), e aggiorna `budget_base_month` su
  `year_settings` per (profile, year). Risponde con lo stato salvato (come GET).

Schemi Zod in `src/shared/schemas.ts`:
- `zBudgetItemInput` = `{ nome: string, importo: number ≥ 0, auto: boolean, ordine: int ≥ 0 }`
- `zBudgetPut` = `{ baseMonth: (int 1..12) | null, items: zBudgetItemInput[] }`
- `zBudgetGet` (output) = `{ baseMonth: number | null, items: BudgetItem[] }`

Errori: envelope standard `{ error: { code, message, details? } }`.
Auth: `requireSession` (come tutte le route di dominio).

L'aliquota e `nettoAnnuo` **non** sono ricalcolati qui: provengono da
`/api/tax/scenario?year=`.

## Client — `src/client/pages/budget.ts`

`mount()` fa 3 fetch parallele (pattern `tasse.ts`):
`/api/budget?year=`, `/api/tax/scenario?year=`, `/api/fatture`.

### Helper puri (no DOM, testabili)
- `monthsWithFatture(fatture, year)` → `Array<{ month: number, lordo: number }>`
  (NC negative, solo totali > 0, ordinati).
- `computeNettoMensile(args: { baseMonth, months, rate, nettoAnnuo })` →
  `{ netto, lordo, rate, month: number | null, source: 'manual' | 'auto' | 'media' }`.
- `computeAllocation(items, nettoMensile)` →
  `{ rows: Array<{ nome, val, isAuto, pct }>, totBudget, rimanente }`.
- Funzioni di render pure per selettore, intestazione netto/tasse, tabella voci,
  totali, distribuzione.

### Interazione
Stato locale (items + baseMonth) modificato in-place → re-render immediato →
**PUT debounced (~500ms)**. Aggiunta/rimozione voce, toggle auto, edit nome/importo/%
e cambio base month aggiornano lo stato e schedulano il salvataggio.

### needsConfig
Se lo scenario è `needsConfig` (niente aliquota), mostrare una CTA "Configura
l'anno" come in `tasse.ts`/`regime.ts` (il budget non è calcolabile senza aliquota).

## Stili

Nuova sezione/file CSS per il budget portando le classi CalcoliVari
(`budget-base-selector`, `budget-header`, `budget-row`, `budget-row-5`,
`budget-auto-check`, barra di distribuzione), mappate sui token Lira esistenti.
Niente stili inline pesanti come nell'originale: estrarre in classi.

## Routing

`src/client/main.ts`: `/budget` → `() => import('./pages/budget')` (rimuove placeholder).

## Test

- **Helper puri** (`budget.test.ts`):
  - `computeNettoMensile`: manuale / auto / media; mese inesistente → fallback.
  - `monthsWithFatture`: NC negative, esclusione bozze, esclusione mesi ≤ 0.
  - `computeAllocation`: split auto equo, importi fissi + auto misti, % → importo,
    rimanente negativo.
- **Route server** (`budget.test.ts` lato server, pattern `fatture.test.ts`):
  - GET vuoto → `{ baseMonth: null, items: [] }`.
  - PUT replace: sostituisce gli item, salva baseMonth, GET successivo coerente.
  - Validazione: baseMonth fuori range, importo negativo → 400 envelope.
  - Isolamento per profilo/anno.

## Fuori scope

- Cross-anno nel selettore base (deciso: solo anno visualizzato).
- Modifica/aggiunta voci tramite PATCH granulare (si usa replace bulk).
- Categorie/colori personalizzabili per voce (colori da palette fissa, come CalcoliVari).
