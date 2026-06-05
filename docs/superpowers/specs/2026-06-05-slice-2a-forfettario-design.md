# Slice 2A — Tax engine + Scadenziario forfettario — Design

Data: 2026-06-05
Stato: spec in review

## Contesto

Slice 2A è il primo step del modulo fiscale di Lira. Porta il `tax-engine.js` di CalcoliVari (parte matematica forfettario) + il `scadenziario-engine.js` in TypeScript strict, server-side autoritativo, con i 7 rilievi dell'audit CalcoliVari 25/05/2026 fixati by-design.

Slice 2B (ordinario PF + IRPEF scaglioni + addizionali con DB Comuni/Regioni) è separato e avrà brainstorming proprio dopo la chiusura di 2A.

## Decisioni fissate in brainstorming

1. **Regimi**: solo forfettario in 2A. Ordinario PF in 2B.
2. **Fiscozen**: tutto il blocco `classifyFiscozenDescription` / `normalizeFiscozenFutureTaxes` / `normalizeFiscozenPaidTaxes` / `buildYearFamilyComparisonMatrix` (~400 righe) **escluso**. Se servirà riconciliazione esterna, slice dedicato.
3. **Audit fix**: tutti by-design (no warning post-hoc bolt-on). Audit findings rilevanti: C1, C3, A1, A5, A6, M1, M3.
4. **Persistenza calcoli**: computed-only. Niente tabella `tax_assessments` o `scadenziario_rows`. Lo scadenziario è una view derivata da `year_settings + fatture + pagamenti`.
5. **INPS params + soglie + coefficienti**: hardcoded in `src/shared/`, no tabella DB.
6. **Addizionali Comuni/Regioni**: rimandate a 2B (con DB ufficiale Comuni+Regioni).

## Architettura

```
src/shared/
  forfettario-rules.ts      # soglie 85k/100k, sostitutiva 15%/5%, riduzione 35%
  inps-params.ts            # OFFICIAL_ARTCOM_INPS + OFFICIAL_GS_INPS per anno (2024-2026)
  ateco-coefficienti.ts     # mappa codice ATECO → coefficiente (40/54/62/67/78/86%)
  acconto-rules.ts          # soglie 51.65 / 257.52 + pesi 40/60 (art. 17 c. 3 DPR 435/2001)
  date-rules.ts             # buildRolledDueDate (slittamento festivi nazionali IT + Pasquetta)
  schedule-keys.ts          # ScheduleFamily type + buildScheduleKey + parseScheduleKey
  audit-checks.ts           # evaluateAuditChecks + predicati C1, A1, M1
  schemas.ts                # estensione Zod per YearSettings, Pagamento, ScadenziarioView (esiste già nel foundation)

src/server/lib/
  tax-engine.ts             # pure: buildAccontoPlan, buildForfettarioScenario,
                            #       buildForfettarioMethodComparison, buildTransitionDiagnostics,
                            #       buildInstallmentStatus, buildInstallmentExplanation
  scadenziario-engine.ts    # pure: buildScadenziario (13 righe, slittamento, proroga, status)

src/server/services/
  scadenziario-service.ts   # I/O: carica year_settings + fatture + pagamenti,
                            #      chiama engine, restituisce ScadenziarioView

src/server/routes/
  year-settings.ts          # GET/PUT/PATCH year-settings + warnings
  pagamenti.ts              # CRUD + quick-pay
  scadenziario.ts           # GET /api/scadenziario/:year
  tax.ts                    # POST /api/tax/simulate, GET /api/tax/rules
```

Principi:
- `src/shared/*` = costanti + regole pure, zero IO. Riusabile client-side per preview.
- `src/server/lib/*` = pure functions fiscali, deterministicche, testabili senza DB.
- `src/server/services/*` = orchestrazione I/O + chiamata engine.
- `src/server/routes/*` = HTTP boundary, validation Zod, mapping a service.

## Schema DB

### Migration `drizzle/0001_audit_fixes_year_settings.sql`

```sql
ALTER TABLE year_settings ADD COLUMN proroga_saldo_at TEXT;
ALTER TABLE year_settings ADD COLUMN riduzione_35_comunicata INTEGER NOT NULL DEFAULT 0;
ALTER TABLE year_settings ADD COLUMN riduzione_35_data_comunicazione TEXT;
```

| Campo | Tipo | Razionale |
|---|---|---|
| `proroga_saldo_at` | ISO date nullable | Fix A5 — se settato, saldo+acc1 prorogabili slittano lì |
| `riduzione_35_comunicata` | 0/1 default 0 | Fix M1 — warning se 1 ma 0 nello stato |
| `riduzione_35_data_comunicazione` | ISO date nullable | Audit trail per M1 |

### Formalizzazione `pagamenti.linked_keys` come breakdown

Era: `string[]` (es. `["imposta_acc1_2025", "inps_fissi_2_2025"]`)
Diventa: `Array<{ key: string; amount: number }>`

Motivazione: A6 richiede di sottrarre dal saldo gli acconti **realmente** pagati. Per F24 misti senza breakdown esplicito non è possibile. Validazione Zod in `src/shared/schemas.ts`.

Cambio sicuro: il foundation slice non ha pagamenti reali nel DB.

### Convention `schedule_key` (in `src/shared/schedule-keys.ts`)

```ts
export type ScheduleFamily =
  | 'imposta_saldo' | 'imposta_acc1' | 'imposta_acc2'
  | 'contributi_saldo' | 'contributi_acc1' | 'contributi_acc2'
  | 'inps_fissi_1' | 'inps_fissi_2' | 'inps_fissi_3' | 'inps_fissi_4'
  | 'bollo_q123' | 'bollo_q4'
  | 'camera' | 'inail';

export function buildScheduleKey(family: ScheduleFamily, year: number): string;
export function parseScheduleKey(key: string): { family: ScheduleFamily; year: number } | null;
```

### Costanti hardcoded (no tabella DB)

`src/shared/inps-params.ts`:
```ts
export const INPS_ARTCOM = {
  2024: { minimaleAnnuo, quotaFissaAnnua, aliquota, aliquotaCommerciante, massimale },
  2025: { ... },
  2026: { ... },
};
export const INPS_GS = {
  2024: { aliquotaSenzaAltraCassa, aliquotaConAltraCassa, massimale },
  2025: { ... },
  2026: { ... },
};
```

Modifica annuale = code change + deploy = audit trail Git. Niente UI di edit.

### Cosa NON cambia

- Niente `tax_assessments` / `scadenziario_rows` / `installments` — tutto computed
- Niente `comuni` / `aliquote_*` — rimandato a 2B
- Niente cambio a `fatture` / `clienti` / `dichiarazioni`

## API surface

Tutti sotto `requireSession`. Validation Zod via `@hono/zod-validator`.

### Year settings

```
GET    /api/year-settings/:year                → YearSettings | 404
PUT    /api/year-settings/:year                → upsert
PATCH  /api/year-settings/:year/warnings       → { confirm?: string[], unconfirm?: string[] }
```

Boundary validation (refuse al boundary, no warning runtime):
- `regime ∈ {forfettario}` (ordinario → 422 fino a 2B)
- `coefficiente ∈ {0.40, 0.54, 0.62, 0.67, 0.78, 0.86}`
- `impostaSostitutiva ∈ {0.05, 0.15}`. Se 0.05, server verifica `year - yearOf(profile.attivita.dataInizioAttivita) < 5` (fix A1)
- `inpsMode ∈ {artigiani_commercianti, gestione_separata}`
- `prorogaSaldoAt` se valorizzato: ISO date nel mese 07/N (sanity)

### Pagamenti

```
GET    /api/pagamenti?year=YYYY                → Pagamento[]
POST   /api/pagamenti                          → create
POST   /api/pagamenti/quick-pay                → body: { scheduleKey, importo?, data? }
                                                  default importo=previsto, data=oggi
PATCH  /api/pagamenti/:id                      → edit
DELETE /api/pagamenti/:id                      → hard delete (3 utenti, no soft)
```

### Scadenziario

```
GET    /api/scadenziario/:year                 → ScadenziarioView
```

Shape risposta:
```ts
{
  year: number;
  method: 'storico' | 'previsionale';
  rows: Array<{
    id: string;                                 // scheduleKey
    title: string;
    family: ScheduleFamily;
    kind: 'tax' | 'contribution';
    competenceYear: number;
    dueDate: string;                            // ISO yyyy-mm-dd, post-rolling
    dueDateOriginal: string;                    // ISO yyyy-mm-dd, pre-rolling
    dueDateRolled: boolean;
    prorogaApplied: boolean;
    amount: { low: number; high: number; point: number };
    certainty: 'official' | 'estimated' | 'forecast';
    payments: Array<{ id: string; data: string; importo: number; mode: 'pure' | 'mixed' }>;
    paidTotal: number;
    status: { code: 'paid'|'underpaid'|'overpaid'|'estimated'|'to_confirm'; label: string; tone: string };
    explanation: string;
  }>;
  summary: { totalDue: number; totalPaid: number; totalResidual: number; nextDue: Row | null };
  methodComparison: {
    historical: ForfettarioScenario;
    previsionale: ForfettarioScenario;
    prudential: 'historical' | 'previsionale';
    liquidity: 'historical' | 'previsionale';
    deltaCash: number;
  };
  warnings: AuditWarning[];                     // C1, M1, NO_REVENUE_SOURCE, A5_PROROGA_APPLICATA, ...
  transition: TransitionInfo;
  rulesRef: string;                             // '/api/tax/rules?year=YYYY'
}
```

Sorgente `grossCollected` per scadenziario reale (priorità):
1. Somma `fatture.importo` con `pag_anno = year` (sarà 0 fino a Slice 4)
2. `year_settings.primo_anno_fatturato_prec` (onboarding)
3. 0 + warning `NO_REVENUE_SOURCE`

### Tax simulate + rules

```
POST   /api/tax/simulate                       → body: { year, grossCollected, settings?, method? }
                                                  → ScenarioOutput (pure, no IO, no persistenza)
GET    /api/tax/rules?year=YYYY                → RuleCatalog (INPS_ARTCOM, INPS_GS, coeff ATECO, soglie)
```

### Error envelope

```ts
{ error: { code: string, message: string, details?: unknown } }
```

Codici 2A:
- `422 INVALID_SOSTITUTIVA_5` (fix A1 boundary)
- `422 REGIME_NOT_SUPPORTED` (regime='ordinario' fino a 2B)
- `422 COEFFICIENTE_NON_AMMESSO`
- `422 INPS_MODE_INVALID`
- `422 PROROGA_FUORI_LUGLIO`
- `409 PAGAMENTO_SCHEDULE_KEY_UNKNOWN`
- `400 INVALID_SCHEDULE_KEY`
- `404 YEAR_SETTINGS_NOT_FOUND`

## Tax engine

`src/server/lib/tax-engine.ts` — pure functions, port fedele del `tax-engine.js` di CalcoliVari (parte matematica), con 2 estensioni di firma per A6 e import M3 da costanti.

### Public surface

```ts
export function buildAccontoPlan(baseAmount: number, rules?: AccontoRules): AccontoPlan;
export function buildForfettarioScenario(input: ScenarioInput): ForfettarioScenario;
export function buildForfettarioMethodComparison(input: ComparisonInput): ComparisonOutput;
export function buildTransitionDiagnostics(input: TransitionInput): TransitionInfo;
export function buildInstallmentStatus(row: ScheduleRow, payments: PaymentBreakdown[]): InstallmentStatus;
export function buildInstallmentExplanation(row: ScheduleRow): string;
```

### Estensione firma per fix A6

```ts
interface ScenarioInput {
  ...,
  accontiSostitutivaPagatiReali: number;        // nuovo. somma effettiva acc1+acc2 dal pagamenti
  accontiContribPagatiReali: number;            // nuovo. analogo per INPS eccedente
}
```

Engine:
```ts
const taxSaldo = ceil2(Math.max(substituteTax - accontiSostitutivaPagatiReali, 0));
const contributionSaldo = ceil2(Math.max(contribuzioneTotale - accontiContribPagatiReali, 0));
```

Sorgente acconti reali (computata dal service): somma di `pagamenti` con `schedule_key ∈ {imposta_acc1_${year-1}, imposta_acc2_${year-1}}` per `accontiSostitutivaPagatiReali`; analogo per `contributi_acc*_${year-1}`. Include sia pagamenti puri (matched su `scheduleKey`) sia split da `linkedKeys[]` breakdown.

`previousTaxBase` resta come fallback storico. Test di non-regressione: se `accontiPagatiReali == acconti stimati`, output identico a CalcoliVari.

### Import M3 da costanti

`buildAccontoPlan` non hard-codice 51.65 / 257.52. Importa da `src/shared/acconto-rules.ts`:
```ts
export const ACCONTO_RULES = Object.freeze({
  thresholdZero: 51.65,
  thresholdSingle: 257.52,
  weights: [40, 60],
  // Ref: art. 17 c. 3 DPR 435/2001
});
```

Test diretti sui boundary: 51.64 / 51.65 / 51.66, 257.51 / 257.52 / 257.53.

### Riduzione 35% INPS

Applicazione `* 0.65` su `currentContribution.fixedAnnual` e `saldoAccontoBase` da `INPS_ARTCOM[year]`. Resta nel tax engine. Warning M1 sta in `audit-checks.ts` (separato).

### Non-goal del tax engine

- Costruzione righe scadenziario (date, slittamento, INPS 4 rate) → scadenziario-engine
- Lettura DB → service
- IRPEF / addizionali → 2B
- Fiscozen → escluso

## Scadenziario engine

`src/server/lib/scadenziario-engine.ts` — pure function, assembla righe del calendario fiscale.

### Public surface

```ts
export interface ScadenziarioInput {
  year: number;                                 // anno di scadenza
  yearSettings: YearSettings;
  previousYearSettings: YearSettings | null;    // null solo se è il primo anno fiscale per il profilo
  scenarios: { historical: ForfettarioScenario; previsionale: ForfettarioScenario };
  paymentsByKey: Map<string, { paidTotal: number; payments: PaymentBreakdown[] }>;
  bolloByQuarter: { q123: number; q4: number }; // calcolato dal service: somma `fatture.bolloAddebitato * 2€` per fatture con `data` nel quarter
  cameraCommerce: number;                       // 2A: 53€ default forfettario commercianti, override possibile da year_settings.overrides
}

export interface ScadenziarioOutput {
  year: number;
  method: 'storico' | 'previsionale';
  rows: ScheduleRow[];
  summary: { totalDue: number; totalPaid: number; totalResidual: number; nextDue: ScheduleRow | null };
  warnings: AuditWarning[];                     // C3, A5 (scheduling-derived)
}

export function buildScadenziario(input: ScadenziarioInput): ScadenziarioOutput;
```

### Catalogo righe (per anno = N)

| ScheduleKey | Famiglia | Competenza | Due date base | Proroga A5 |
|---|---|---|---|---|
| `imposta_saldo_${N-1}` | sostitutiva saldo | N-1 | 30/06/N | sì |
| `imposta_acc1_${N}` | sostitutiva acc1 | N | 30/06/N | sì |
| `imposta_acc2_${N}` | sostitutiva acc2 | N | 30/11/N | no |
| `contributi_saldo_${N-1}` | INPS variabile saldo | N-1 | 30/06/N | sì |
| `contributi_acc1_${N}` | INPS variabile acc1 | N | 30/06/N | sì |
| `contributi_acc2_${N}` | INPS variabile acc2 | N | 30/11/N | no |
| `inps_fissi_1_${N}` | INPS quota fissa | N | 16/05/N | no |
| `inps_fissi_2_${N}` | INPS quota fissa | N | 20/08/N | no |
| `inps_fissi_3_${N}` | INPS quota fissa | N | 16/11/N | no |
| `inps_fissi_4_${N}` | INPS quota fissa | N | 16/02/N+1 | no |
| `bollo_q123_${N}` | Bollo Q1+Q2+Q3 | N | 30/09/N | no |
| `bollo_q4_${N}` | Bollo Q4 | N | 28/02/N+1 | no |
| `camera_${N-1}` | Camera commercio | N-1 | 30/06/N | sì |

INAIL omesso (Mattia/Peru non iscritti).

### Fix C3 — slittamento del 28/02

`src/shared/date-rules.ts`:
```ts
export function buildRolledDueDate(iso: string): { date: string; rolled: boolean };
```

Festivi nazionali fissi: 01/01, 06/01, 25/04, 01/05, 02/06, 15/08, 01/11, 08/12, 25/12, 26/12 + Pasquetta (calcolata).

Fix C3: tutte le righe passano dallo stesso helper, niente codepath separato per 28/02. Test esplicito: 28/02/2026 sabato → atteso 02/03/2026 (1/3 domenica).

### Fix A5 — proroga propagation

```ts
const PROROGABILI: ScheduleFamily[] = [
  'imposta_saldo', 'imposta_acc1',
  'contributi_saldo', 'contributi_acc1',
  'camera',
];
```

Quando `yearSettings.prorogaSaldoAt` è valorizzato:
- per ogni row con family ∈ PROROGABILI e due_date base 30/06/N:
  - `dueDate = prorogaSaldoAt`
  - `dueDateRolled = false`
  - `prorogaApplied = true`
- warning info `A5_PROROGA_APPLICATA` aggiunta a `warnings[]`

acc2 (30/11) e INPS fissi inalterati.

### Amount + certainty per riga

| Riga | Amount | Certainty |
|---|---|---|
| imposta saldo | `scenario.taxSaldo` (A6: netto degli acconti reali) | `estimated`/`official` |
| imposta acc1/acc2 | `scenario.taxAcconti.first` / `.second` | `forecast`/`estimated` |
| contributi saldo | `scenario.contributionSaldo` | come sopra |
| contributi acc1/acc2 | `scenario.contributionAcconti.first/.second` | come sopra |
| inps fissi 1-4 | `INPS_ARTCOM[N].quotaFissaAnnua / 4` (×0.65 se riduzione_35) | `official` |
| bollo q123 / q4 | `input.bolloByQuarter` | `official` |
| camera | `input.cameraCommerce` | `official` |

Amount sempre `{low, high, point}`. Per fissi/bollo/camera low=high=point. Per previsionali low/high possono divergere.

### Status + explanation

Per ogni row: `buildInstallmentStatus(row, paymentsByKey.get(row.id))` + `buildInstallmentExplanation(row)` (entrambi dal tax-engine).

### Method selection

Output `rows` usa scenario corrispondente a `yearSettings.scadenziarioMetodo`. `methodComparison` (entrambi side-by-side) è separato, emesso dal service.

## Audit checks (boundary + runtime)

`src/shared/audit-checks.ts` — pure module, condiviso client+server.

```ts
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
  yearSettings: YearSettings;
  profile: { dataInizioAttivita: string };
  grossCollected: number;
  today: string;                                // ISO yyyy-mm-dd, injected per test
}

export function evaluateAuditChecks(ctx: AuditContext): AuditWarning[];
export function checkC1_soglia(ctx: AuditContext): AuditWarning | null;
export function checkA1_sostitutivaStartup(ctx: AuditContext): AuditWarning | null;
export function checkM1_riduzione35NonComunicata(ctx: AuditContext): AuditWarning | null;
```

### Catalogo warning codes 2A

| Code | Severity | Quando |
|---|---|---|
| `C1_SOGLIA_85K_SUPERATA` | warning | `85k < grossCollected ≤ 100k` |
| `C1_CESSAZIONE_IMMEDIATA` | warning | `grossCollected > 100k` |
| `A1_SOSTITUTIVA_5_REQUISITI` | info | sempre quando `impostaSostitutiva = 0.05` |
| `A5_PROROGA_APPLICATA` | info | quando `prorogaSaldoAt` valorizzata |
| `M1_RIDUZIONE_35_NON_COMUNICATA` | warning | `riduzione_35=1 && riduzione_35_comunicata=0` |
| `NO_REVENUE_SOURCE` | info | `grossCollected = 0` e nessuna fattura/onboarding |

Tutti i warnings includono `context` con valori che hanno triggerato il check.

### Boundary blocks (refuse al boundary, no warning runtime)

| Codice | Trigger |
|---|---|
| `422 INVALID_SOSTITUTIVA_5` | `impostaSostitutiva=0.05 && (year - yearOf(dataInizioAttivita)) >= 5` |
| `422 REGIME_NOT_SUPPORTED` | `regime='ordinario'` fino a 2B |
| `422 COEFFICIENTE_NON_AMMESSO` | `coefficiente ∉ {0.40, 0.54, 0.62, 0.67, 0.78, 0.86}` |
| `422 INPS_MODE_INVALID` | `inpsMode ∉ {artigiani_commercianti, gestione_separata}` |
| `422 PROROGA_FUORI_LUGLIO` | `prorogaSaldoAt` non in 07/N |
| `409 PAGAMENTO_SCHEDULE_KEY_UNKNOWN` | quick-pay con key non parseScheduleKey-valida |
| `400 INVALID_SCHEDULE_KEY` | linkedKeys con key malformata |
| `404 YEAR_SETTINGS_NOT_FOUND` | GET scadenziario senza year_settings |

### `confirmedWarnings` flow

`year_settings.overrides` JSON: `{ confirmedWarnings: string[] }`. Backend restituisce sempre tutte le warnings, con flag `confirmed: boolean`. Cambio setting invalida conferma (re-emerge come unconfirmed). Le warnings `block` non sono confirmabili.

```
PATCH /api/year-settings/:year/warnings
  body: { confirm?: string[], unconfirm?: string[] }
```

## Testing strategy

TDD strict obbligatorio (CLAUDE.md). Runner: `node --test` + `tsx`. Target: ~130 test verdi a fine slice (foundation: 34, slice 2A: ~95 nuovi).

### Piramide

- E2E: 0 (no UI in 2A)
- Integration: ~19 (routes + DB libsql temp)
- Unit: ~77 (pure functions)

### Unit

| Modulo | Test target | Focus |
|---|---|---|
| `acconto-rules.ts` | 3 | costanti freeze, import dimostrato |
| `date-rules.ts` (buildRolledDueDate) | ~12 | sab/dom + festivi + Pasquetta + **C3** 28/02/2026 |
| `schedule-keys.ts` | ~6 | roundtrip, malformed, unknown family |
| `inps-params.ts` | 4 | get 2024/2025, riduzione_35, anno mancante throw |
| `ateco-coefficienti.ts` | 3 | gruppo trovato, non valido, 6 cifre |
| `audit-checks.ts` | ~12 | C1×4, A1×3, M1×2, NO_REVENUE×1, evaluateAll×2 |
| `tax-engine.buildAccontoPlan` | ~6 | **M3** boundary, modi, pesi |
| `tax-engine.buildForfettarioScenario` | ~10 | 8 combinazioni + **A6**×2 |
| `tax-engine.buildForfettarioMethodComparison` | 3 | deltaCash, prudential, transition |
| `tax-engine.buildTransitionDiagnostics` | 3 | regime change, anno misto, fresh |
| `tax-engine.buildInstallmentStatus` | 5 | paid/underpaid/overpaid/estimated/to_confirm |
| `scadenziario-engine.buildScadenziario` | ~10 | 13 righe, **C3**, **A5**, slittamento, riduzione_35, status |

### Integration — `src/server/routes/*.test.ts`

Pattern foundation: libsql temp DB, sessione cookie da login.

| Route | Test target | Casi |
|---|---|---|
| `year-settings.routes.test.ts` | 6 | GET 404, PUT happy, PUT 422 A1, PUT 422 ordinario, PUT 422 coefficiente, PATCH warnings |
| `pagamenti.routes.test.ts` | 6 | CRUD, quick-pay default, quick-pay 409, linkedKeys breakdown, DELETE, filter year |
| `scadenziario.routes.test.ts` | 4 | GET 13 righe, GET A5, GET C1, GET 404 |
| `tax-simulate.routes.test.ts` | 2 | happy + boundary |
| `tax-rules.routes.test.ts` | 1 | GET rules per anno |

### Golden fixture

`tests/fixtures/mattia-2025.ts` + `tests/fixtures/peru-2025.ts` — casi reali ricostruiti da CalcoliVari. Numeri presi running side-by-side, calibrati al 1° run, poi congelati. Regression anchor per il porting.

### Workflow TDD per ogni unit

1. Test failing (rosso)
2. Implementazione minima (verde)
3. Refactor con test verde
4. Niente `as any`, niente `// @ts-ignore`

Eccezione golden fixture: numeri attesi si calibrano dopo il 1° run, poi frozen.

### Verification before completion (CLAUDE.md)

```bash
npm test                     # tutti verdi
npm run build                # type-check ok
```
+ smoke manuale opzionale: avvio server + curl golden endpoint.

### Niente in 2A

- Test E2E Playwright (Slice 4)
- Test di performance (irrilevante per 3 utenti)
- Property-based testing (overkill)
- Snapshot testing (fragile per shape complesse)

## Audit fix coverage summary

| Fix | Implementato in | Tipo | Test esplicito |
|---|---|---|---|
| C1 (soglia 85k/100k) | `src/shared/audit-checks.ts` | warning runtime | `audit-checks.test.ts` ×4 casi |
| C3 (bollo Q4 28/02 slittamento) | `src/shared/date-rules.ts` (uniforme) | comportamento | `date-rules.test.ts` 28/02/2026 |
| A1 (sostitutiva 5% startup) | route `PUT year-settings` 422 + warning info | block + info | `year-settings.routes.test.ts` 422 |
| A5 (proroga propagation) | `scadenziario-engine.ts` | comportamento + info | `scadenziario-engine.test.ts` A5 |
| A6 (saldo - acconti reali) | `tax-engine.buildForfettarioScenario` | formula | `tax-engine.test.ts` A6×2 |
| M1 (riduzione 35 non comunicata) | `src/shared/audit-checks.ts` | warning runtime | `audit-checks.test.ts` M1 |
| M3 (soglie 51.65 / 257.52) | `src/shared/acconto-rules.ts` (costanti) | costanti centralizzate | `acconto-rules.test.ts` + `buildAccontoPlan.test.ts` boundary |

## Definition of Done

- [ ] Migration `0001_audit_fixes_year_settings.sql` generata + applicata
- [ ] Tutti i moduli `src/shared/*` (forfettario-rules, inps-params, ateco-coefficienti, acconto-rules, date-rules, schedule-keys, audit-checks) implementati con test verdi
- [ ] `src/server/lib/tax-engine.ts` + `scadenziario-engine.ts` implementati con test verdi (~77 unit totali)
- [ ] 4 file route nuovi (year-settings, pagamenti, scadenziario, tax) con integration test (~19)
- [ ] Golden fixture Mattia/Peru 2025 verdi side-by-side con CalcoliVari
- [ ] `npm test` verde, `npm run build` verde
- [ ] PR a `origin/main` mergiata

## Out of scope (esplicito)

- Ordinario PF / IRPEF / addizionali → Slice 2B
- DB Comuni / Regioni → Slice 2B
- Fatture CRUD + wizard → Slice 4
- Import JSON da CalcoliVari → Slice 3
- Frontend UI scadenziario (pagine, componenti) → futuro slice UI
- E2E Playwright → futuro slice UI
- Fiscozen reconciliation → futuro slice (se mai)
- INAIL → futuro (Mattia/Peru non iscritti)
- Deploy Fly → futuro
- Backup automatico → futuro
- Audit log modifiche → futuro
