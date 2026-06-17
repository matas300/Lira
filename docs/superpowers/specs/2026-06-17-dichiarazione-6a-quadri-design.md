# Slice 6A — Dichiarazione: quadri LM/RR/RX/RS (read-only) — Design

> Data: 2026-06-17. Ultima pagina del build frontend (port da CalcoliVari,
> riverificato con le skill fiscali). La Dichiarazione è lo slice più grande →
> **decomposto**: 6A = quadri (questo), 6B = F24, 6C = override/quadri di nicchia.

## Obiettivo

Costruire la **dichiarazione dei redditi PF forfettaria** (Redditi PF, quadri
LM/RR/RX/RS + frontespizio) come **vista read-only server-authoritative** che
**mappa lo scenario fiscale già calcolato da Lira** nei righi ufficiali, senza
duplicare la matematica fiscale.

## Razionale (audit CalcoliVari + riuso Lira)

Il motore `dichiarazione-engine.js` di CalcoliVari (826 righe) è stato mappato e
auditato. È fiscalmente corretto sull'impianto (LM cassa art.1 c.64 L.190/2014,
perdite 5 anni art.84 TUIR, riduzione 35% art.1 c.77, startup 5% art.1 c.65, RS
informativo non deducibile, CE non scomputabile da forfettario). Gap risolti
**by-design** in Lira:

- **Aliquote INPS hardcoded 2025** → in Lira sono già year-aware dentro
  `scenario-data.ts`/`buildContributionParams` (lette da `year_settings`), quindi
  RR mappa dai campi già calcolati dello scenario.
- **Acconti non auto-calcolati** → già calcolati dal tax-engine
  (`taxAcconti`/`contributionAcconti`, split 50/50 ISA + soglie 51,65/257,52, già
  audit-fixed in Slice 2A). Usati da 6B (F24).
- **Coefficiente non validato** → in Lira viene da `year_settings` e dalla tabella
  ATECO DM 23/01/2015 (`ateco-coefficienti.ts`).
- **F24 assente** → 6B (riusa le date dello scadenziario).

**Single source of truth**: il `ForfettarioScenario` già espone ricavi,
coefficiente→reddito lordo, contributi deducibili (cassa), imponibile, imposta
sostitutiva, saldo, contributi fissi/variabili. La dichiarazione **non ricalcola**:
mappa.

## Scope

**Dentro (6A):** Frontespizio, quadro **LM** (reddito forfettario + imposta
sostitutiva), quadro **RR** (INPS: sez. II gestione separata OPPURE sez. I
artigiani/commercianti), quadro **RX** (compensazioni/crediti), quadro **RS**
(dati informativi forfettari), validazione/warning. Tutto **read-only** (derivato
dai dati reali Lira; nessun override editabile in 6A).

**Fuori (documentato come non supportato):** RW (attività estere / IVAFE / IVIE /
cripto), RN (anno misto IRPEF — stima), CE, CR. YAGNI per 3 utenti forfettari
privati; si aggiungono solo se serviranno. F24 → 6B. Override manuali + perdite
pregresse → 6C.

## Architettura

Pattern identico a tax/scadenziario/regime: **motore puro server-side** +
**route** che carica i dati e chiama il motore + **pagina client read-only**.

### 1. Motore puro — `src/server/lib/dichiarazione-engine.ts`

Funzione pura (no DB, no I/O), testabile:

```
buildDichiarazione(input: DichiarazioneInput): Dichiarazione
```

`DichiarazioneInput`:
- `year: number`
- `scenario: ForfettarioScenario` (il `.selected` da `buildForfettarioMethodComparison`)
- `ys`: i campi rilevanti di `year_settings` (`regime`, `inpsMode`, `inpsCategoria`,
  `impostaSostitutiva`, `coefficiente`, `riduzione35`, `limiteForfettario`)
- `anagrafica`: oggetto profilo (`cf`, `nome`, `cognome`, `data_nascita`,
  `residenza{citta,provincia,…}`) per il frontespizio
- `dataInizioAttivita?: string` (da `profiles.attivita`, per il check startup 5%)

`Dichiarazione` (output):
- `frontespizio`: `{ codiceFiscale, cognome, nome, dataNascita, comune,
  provincia, annoImposta, regime: 'RF19', tipoDichiarazione: 'ordinaria' }`
  (campi `from-profile`; `''` se mancanti → genera warning)
- `quadroLM`: `Rigo[]`
- `quadroRR`: `{ sezione: 'gestione_separata' | 'artigiani_commercianti'; righi: Rigo[] }`
- `quadroRX`: `Rigo[]`
- `quadroRS`: `Rigo[]`
- `warnings`: `Warning[]`

`Rigo = { key: string; label: string; value: number; source: 'computed' | 'from-profile' | 'zero' }`
`Warning = { code: string; severity: 'error' | 'warn' | 'info'; message: string }`

#### Mappatura righi (scenario → quadri)

**LM** (forfettario, sez. III):
- `LM1` Ricavi/compensi percepiti = `scenario.grossCollected`
- `LM2` Reddito lordo = `scenario.forfettarioGrossIncome` (ricavi × coefficiente)
- `LM3` Contributi INPS deducibili (cassa) = `scenario.deductibleContributionsPaid`
- `LM4` Reddito netto = `max(0, LM2 − LM3)` (= `scenario.taxableBase` se perdite=0)
- `LM34` Reddito imponibile = `scenario.taxableBase` (perdite pregresse = 0 in 6A)
- `LM36`/`LM38` Imposta sostitutiva (lorda) = `scenario.substituteTax`
- `LM39` Detrazioni/crediti = 0 (`zero`, override→6C)
- `LM40` Imposta netta = `LM38 − LM39` = `scenario.substituteTax`
- `LM41` Ritenute = 0 (forfettario non subisce ritenuta, art.1 c.67 — `zero`)
- `LM42` Credito anno prec. = 0 (`zero`, →6C/RX)
- `LM43` Acconti versati = acconti sostitutiva realmente versati (dallo scenario,
  `accontiSostitutivaPagatiReali` se esposto; altrimenti derivato da `substituteTax − taxSaldo`)
- `LM45` Imposta a debito (saldo) = `scenario.taxSaldo`
- `LM46` Imposta a credito = `max(0, −(LM40 − LM43))`

**RR** — ramo su `ys.inpsMode`:
- *Gestione separata (sez. II):* `RR1`(base)=`LM4`; `RR2` contributi dovuti =
  `scenario.contributiVariabiliDovuti` (GS: reddito×aliquota year-aware, già nello
  scenario); acconti/saldo da scenario (`contributionAcconti`/saldo → dettaglio in 6B).
- *Artigiani/commercianti (sez. I):* fissi = `scenario.previousFixedTail +
  scenario.currentFixedWithinYear`; variabili = `scenario.contributiVariabiliDovuti`;
  totale dovuti = fissi + variabili (riduzione 35% già applicata nello scenario).

**RX** (compensazioni): `RX1` credito anno prec. = 0 (6A; →6C); `RX4` = `RX1`.

**RS** (dati informativi): `RS371`–`RS381` = 0 (`zero`), con nota informativa che
NON deducono dal reddito forfettario.

#### Validazione (warning)

- `error` `REGIME_NON_FORFETTARIO` se `ys.regime !== 'forfettario'`.
- `error` `FRONTESPIZIO_INCOMPLETO` se mancano CF / cognome+nome / data nascita.
- `warn` `SOGLIA_85K` se `LM2 > limiteForfettario` (decadenza dall'anno successivo).
- `warn` `SOGLIA_100K` se `LM2 > limiteForfettario + 15000` (decadenza immediata).
- `warn` `STARTUP_5PCT_SCADUTO` se `impostaSostitutiva === 0.05` e
  `year − anno(dataInizioAttivita) > 4`.
- `info` `RS_INFORMATIVO` sempre (i dati RS non deducono).

### 2. Route — `src/server/routes/dichiarazione.ts`

`GET /api/dichiarazione/:year` (sotto `requireSession`, profilo attivo):
1. `loadScenarioData(db, profileId, year)` → `null` ⇒ `{ needsConfig: true, year }`.
2. `buildForfettarioMethodComparison(comparisonInput)` → `selected`.
3. carica profilo attivo (anagrafica + attivita) + year-settings.
4. `buildDichiarazione({...})` → `dichiarazione`.
5. `c.json({ year, needsConfig: false, dichiarazione })`.

Registrata in `server/index.ts`. Output validato con Zod (`@shared/schemas`).

### 3. Pagina — `src/client/pages/dichiarazione.ts`

Read-only, pattern `regime.ts` (render puri + `mount`):
- Intestazione **Frontespizio** (anno d'imposta, contribuente, regime RF19) +
  nota "anno d'imposta `<Y>` → dichiarazione presentata nel `<Y+1>`".
- Una **card per quadro** (LM, RR, RX, RS): righi `label … valore` con badge
  `source` (calcolato / da profilo / —).
- Banner **warning** (errori rossi, warn gialli, info neutri).
- **needsConfig** → prompt "Configura il `<anno>`" → `/impostazioni`.
- CTA **"Vai all'F24"** placeholder (abilitata in 6B).
- Route `/dichiarazione` già mappata a `placeholder` in `main.ts` → reale.

## Data flow

```
GET /api/dichiarazione/:year
  → loadScenarioData(db, profileId, year)  [null → needsConfig]
  → buildForfettarioMethodComparison(comparisonInput).selected
  → load profile (anagrafica, attivita) + year_settings
  → buildDichiarazione({ year, scenario, ys, anagrafica, dataInizioAttivita })  [PURO]
  → { year, needsConfig:false, dichiarazione: { frontespizio, quadroLM, quadroRR, quadroRX, quadroRS, warnings } }
→ pagina render read-only
```

## Error handling

- year_settings assente → `needsConfig` (no errore).
- regime ≠ forfettario → warning `error` `REGIME_NON_FORFETTARIO` nel payload
  (la pagina mostra il banner; i righi restano valorizzati a 0/—).
- anagrafica incompleta → warning `error` `FRONTESPIZIO_INCOMPLETO` + link a
  `/profilo-personale`.
- errore di rete → card errore locale nella pagina.

## Test

- **Motore** (`dichiarazione-engine.test.ts`): mappatura LM su uno scenario noto
  (LM1..LM45 coerenti coi campi scenario); RR gestione separata vs artigiani/
  commercianti (fissi+variabili); RX/RS a zero; ogni warning (regime, soglie
  85k/100k, startup scaduto, frontespizio incompleto, RS info). Fixture scenario
  riusando `test-fixtures` esistenti (Mattia 2025).
- **Route** (`dichiarazione.test.ts`): 200 con dichiarazione; needsConfig su anno
  non configurato; scoping profilo attivo.
- **Pagina** (`dichiarazione.test.ts` client): render puri (frontespizio, una card
  per quadro, righi, banner warning, needsConfig prompt, CTA F24 placeholder).

## Fuori scope (ribadito)

RW / RN / CE / CR; F24 (6B); override manuali e perdite pregresse (6C); export
PDF/telematico. Nessuna migration.
