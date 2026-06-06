# Slice 3 — Importer CalcoliVari → Lira (Design / Spec)

- **Data:** 2026-06-06
- **Stato:** approvato (brainstorm), in attesa review spec
- **Slice:** 3 (importer legacy / recovery dati)
- **Predecessore:** Slice 2A (tax engine forfettario + scadenziario) — su `main`
- **Skill workflow:** brainstorm → **spec (questo doc)** → writing-plans → execute

---

## 1. Obiettivo & scope

Costruire l'importer che legge gli export di **CalcoliVari** e popola il DB di Lira, in modo **idempotente**, **dry-run-first** e con **merge "longest wins"** tra backup multipli.

**Scope: tutte e 9 le entità di dominio** (decisione utente 2026-06-06):
`profiles` · `year_settings` · `clienti` · `fatture` · `pagamenti` · `calendar_entries` · `budget_items` · `spese` · `dichiarazioni`.

**Sorgenti supportate (decisione utente):** export **device ufficiale** (`Impostazioni → Esporta JSON`) + **backup-wrapper** degli script di recovery (`extract-mattia.js`). **Niente Firestore** in questa slice.

**Motivazioni:**
1. Recovery dei dati storici Mattia/Peru, inclusi i **pagamenti persi** nell'incident del 2026-05-25.
2. De-risk dello step di migrazione più rischioso (risk-table) **prima** dello switch finale, mentre CalcoliVari è ancora vivo per ri-esportare.
3. Strumento ri-eseguibile a piacere (idempotente) → permette dry-run + diff manuale prima del commit definitivo.

**Non-goals (questa slice):**
- Adattatore Firestore (rimandato; i dati buoni sono recuperabili da export device).
- UI di import (è uno script CLI).
- I moduli consumer (Fatture/Calendario/Budget/Spese/Dichiarazione): le tabelle esistono già, i dati vengono importati anche se l'UI arriverà nelle fasi successive.

---

## 2. Input: formati sorgente

I dati veri **non sono nel repo**: provengono dai device. Due forme da gestire.

### 2.1 Export ufficiale — `calcoli_piva_backup.json`
Prodotto da `exportData()` (CalcoliVari `app-export.js`). Oggetto **flat**, **un solo profilo per file**:

```json
{
  "calcoliPIVA_<P>_<YYYY>":      { "settings": {...}, "pagamenti": [...], "accantonamento": {...}, "budget": [...], "spese": [...], "calendar": {...}, "dichiarazione": {...}, "fatture": {...}, "_fattureManualeWipedBackup": {...} },
  "calcoliPIVA_<P>_fattureEmesse": [ {...}, {...} ],
  "calcoliPIVA_<P>_clienti":       [ {...} ],
  "calcoliPIVA_<P>_giorniIncasso": 30,
  "calcoliPIVA_<P>_clienteDefaultId": "cli_...",
  "calcoliPIVA_profile_<P>":       { "nome": "...", "partitaIva": "...", ... }
}
```

I valori sono **oggetti JSON già deserializzati**. Solo `calcoliPIVA_profile_<P>` ha prefisso diverso (`calcoliPIVA_profile_`, non `calcoliPIVA_<P>_`).

### 2.2 Backup-wrapper — `extract-mattia.js`
```json
{ "profile": "Mattia", "timestamp": "ISO", "keys": { "calcoliPIVA_Mattia_2024": "<STRINGA JSON>", ... } }
```
Differenze: wrapper `{ profile, timestamp, keys }`; i valori in `keys` sono **stringhe** da ri-`JSON.parse`; **manca** `calcoliPIVA_profile_<P>`.

### 2.3 Detection
- Top-level ha `.keys` **e** `.profile` ⇒ **backup-wrapper** (ri-parsare i valori stringa; `profileName = .profile`).
- Altrimenti ⇒ **export ufficiale** (valori già oggetti; `profileName` derivato dal prefisso chiave `calcoliPIVA_<P>_…` o da `calcoliPIVA_profile_<P>`).

### 2.4 Catalogo chiavi → entità
| Chiave localStorage | → entità | Note |
|---|---|---|
| `calcoliPIVA_<P>_<YYYY>` (year-data) | year_settings, pagamenti, calendar, budget, spese, dichiarazione, fatture-legacy | oggetto con sotto-strutture |
| `calcoliPIVA_<P>_fattureEmesse` | fatture (canoniche) | array flat **profile-scoped** |
| `calcoliPIVA_<P>_clienti` | clienti | array |
| `calcoliPIVA_<P>_giorniIncasso` | profiles.giorni_incasso | numero (default 30) |
| `calcoliPIVA_<P>_clienteDefaultId` | clienti.is_default | stringa id |
| `calcoliPIVA_profile_<P>` | profiles (anagrafica/attività legacy) | ⚠ prefisso diverso |
| `calcoliPIVA_<P>_icsExported_*`, `…crossYearReminderDismissed_*`, `…adeConservationAcknowledged` | — | UI-only, **non importate** |
| globali `theme`, `calcoliPIVA_activeTab`, `calcoliPIVA_sidebarCollapsed` | — | non di dominio, **non importate** |

### 2.5 Insidie note (gestite by-design)
- **Doppio prefisso**: `calcoliPIVA_profile_<P>` NON matcha `calcoliPIVA_<P>_` → estrarre esplicitamente.
- **Pagamenti cross-year**: vivono nel doc dell'**anno di cassa** (`data` del versamento); la **competenza** è nel suffisso di `scheduleKey`. Raccoglierli da **tutti** i doc-anno.
- **Fatture legacy**: `data.fatture[mese]` viene azzerato one-time → il backup sta in `data._fattureManualeWipedBackup` (NON syncato su Firestore).
- **`lmQuadro` → `dichiarazione`**: dati vecchi hanno `lmQuadro.overrides`; fonderli in `dichiarazione.overrides`.
- **Typo `totaleDocumento` → `totaleDocument`** (con "o" finale, legacy).
- **`calendar` e `accantonamento`** sono dict **sparsi** (solo entry ≠ default).
- **`coefficiente`/`impostaSostitutiva`** in CalcoliVari sono **percentuali** (es. 67, 15) → Lira vuole **frazioni** (0.67, 0.15).

---

## 3. Architettura & layout moduli

Logica pura in `src/server/lib/`, CLI sottile in `scripts/` (convenzione `create-user.ts`/`create-profile.ts`).

```
src/server/lib/import-calcolivari/
  types.ts            # RawExport, ExtractedData, MappedRows, ImportPlan, ImportIssue
  detect.ts           # formato → RawExport uniforme { profileName, keys }
  extract/
    index.ts          # orchestratore estrazione
    profile.ts        # → raw profilo (merge profile-fiscal + anagrafica/attività multi-anno)
    year-settings.ts  # → raw settings per anno
    clienti.ts        # → raw clienti (+ clienteDefaultId)
    fatture.ts        # → raw fatture (fattureEmesse + legacy da _fattureManualeWipedBackup)
    pagamenti.ts      # → raw pagamenti (cross-year)
    calendar.ts       # → raw calendar entries (sparse "M-D")
    budget.ts         # → raw budget items (+ ordine)
    spese.ts          # → raw spese
    dichiarazioni.ts  # → raw dichiarazione (lmQuadro→dichiarazione)
  map/
    *.ts              # un mapper per entità: raw → riga Lira (tipi Drizzle insert), Zod-validato
  identity.ts         # det(parts) → id deterministico (UUID-shaped, node:crypto)
  merge.ts            # "longest/richer wins" tra file e vs DB
  plan.ts             # diff righe-mappate vs DB → ImportPlan
  apply.ts            # snapshot pre-import + apply in transazione
  index.ts            # buildImportPlan(db, inputs, opts) ; applyImportPlan(db, plan, opts)
  **/*.test.ts        # unit (puri) + plan/apply su createTestDb()

scripts/import-from-calcolivari.ts   # CLI (già wired: npm run import:legacy)
```

Le parti pure (`detect`, `extract`, `map`, `merge`, `identity`) **non toccano il DB**. `plan`/`apply` ricevono `db` (DI, come `createProfileForUser(db, …)`).

---

## 4. Pipeline / data-flow

```
file[]
  → detect/unwrap            (per file → RawExport { profileName, keys })
  → group by profileName
  → extract                  (per profilo → ExtractedData: tutte le entità in forma CalcoliVari normalizzata)
  → merge tra file           (longest/richer wins → ExtractedData unificata)
  → map → Zod                (→ MappedRows: righe Lira validate ; invalidi → ImportIssue[])
  → diff vs DB               (→ ImportPlan: per entità insert/update/identical/issue)
  → [dry-run]  stampa piano + scrive tmp/lira-import-plan-<profilo>.json ; EXIT
  → [--commit] snapshot pre-import + apply in transazione (atomico)
```

---

## 5. Mapping per entità

Convenzioni: `settings` = `calcoliPIVA_<P>_<YYYY>.settings`. Stringa vuota `''` CalcoliVari → `null` Lira. Bool → `0/1`.

### 5.1 `profiles`
**Sorgente:** `calcoliPIVA_profile_<P>` (legacy fiscal) ∪ `settings.anagrafica`/`settings.attivita` di **tutti** gli anni (first-non-empty-wins) ∪ `…_giorniIncasso`.

| Lira col | ← Sorgente | Trasformazione |
|---|---|---|
| `id` | — | lookup `(user_id, slug)`; nuovo uuid v4 se assente |
| `user_id` | `--user <email>` | obbligatorio, deve esistere |
| `slug` | `--slug` o `profileName` | lowercase |
| `display_name` | `profileName` (o `nome cognome`) | |
| `anagrafica` (JSON) | `settings.anagrafica` + legacy fiscal | → `{ cf, nome, cognome, data_nascita, comune_nascita, sesso, residenza:{indirizzo,cap,citta,provincia}, domicilio_fiscale:{…}, telefono, email, iban, modalita_pagamento }` |
| `attivita` (JSON) | `settings.attivita` + `settings.regime` | → `{ partita_iva, codice_ateco, ateco_gruppo, descrizione_attivita, comune_domicilio, data_inizio_attivita, regime_default, agevolazione_startup, primo_anno_agevolato }` |
| `giorni_incasso` | `…_giorniIncasso` | default 30 |

> `anagrafica`/`attivita` seguono la shape **base** di `data-model.md`; i campi CalcoliVari aggiuntivi (domicilio fiscale, telefono, email, iban, `ateco_gruppo`, agevolazioni) sono **preservati** nel JSON (colonna libera → nessuna perdita dati).

### 5.2 `year_settings` — PK `(profile_id, year)`
**Sorgente:** ogni `settings`.

| Lira col | ← Sorgente | Trasformazione |
|---|---|---|
| `regime` | `settings.regime` | `'forfettario'\|'ordinario'` |
| `coefficiente` | `settings.coefficiente` | **normalizza a frazione**: se `>1` → `/100` |
| `imposta_sostitutiva` | `settings.impostaSostitutiva` | idem `/100` se `>1` |
| `inps_mode` | `settings.inpsMode` | |
| `inps_categoria` | `settings.inpsCategoria` | nullable |
| `riduzione_35` | `settings.riduzione35` | 0/1 |
| `ha_reddito_dipendente` | `settings.haRedditoDipendente` | 0/1 |
| `limite_forfettario` | `settings.limiteForfettario` | default 85000 |
| `scadenziario_metodo` | `settings.scadenziarioMetodoAcconti` | `'storico'\|'previsionale'` |
| `primo_anno_*` (5 campi) | `settings.primoAnno*` | `''` → null |
| `overrides` (JSON) | campi `settings.scadenziario*` (saldo/acconto imposta+contributi, dirittoCamerale, bollo Q4 prec/corr, inail corr/succ, overrideDataSaldoImposta) | impacchetta nella forma overrides Lira |
| `proroga_saldo_at`, `riduzione_35_comunicata`, `riduzione_35_data_comunicazione` | — (no sorgente) | null / 0 (colonne Slice 2A) |

> La shape del JSON `overrides` deve **combaciare con ciò che lo `scadenziario-service` (Slice 2A) legge** — allinearla in impl alle chiavi già consumate, non inventarne di nuove.

### 5.3 `clienti`
**Sorgente:** `…_clienti[]` (shape `normalizeCliente`). `is_default` = (`id === clienteDefaultId`).

| Lira col | ← Sorgente |
|---|---|
| `id` | **riuso id CalcoliVari** |
| `nome` | `nome` |
| `tipo_cliente` | `tipoCliente` (`PF\|PG\|PA\|Estero`) |
| `partita_iva` | `partitaIva` |
| `codice_fiscale` | `codiceFiscale` |
| `codice_sdi` | `codiceSDI` (default `'0000000'`) |
| `pec` | `pec` |
| `indirizzo`/`cap`/`citta`/`provincia`/`nazione` | omonimi |
| `descrizione_standard` | `descrizioneStandard` |
| `is_default` | `id === clienteDefaultId` ? 1 : 0 |
| `note` | `note` |

Riconciliazione unique: se `(profile, partita_iva)` o `(profile, codice_fiscale)` collide con id diverso → trattare come **update dello stesso cliente logico** (merge), non insert.

### 5.4 `fatture`
**Sorgente primaria:** `…_fattureEmesse[]` (shape `normalizeFatturaEmessa`). Chiave naturale upsert: `(profile_id, anno_progressivo, progressivo)`.

| Lira col | ← Sorgente | Note |
|---|---|---|
| `id` | riuso id CalcoliVari | |
| `cliente_id` | `clienteId` | null se cliente non importato (FK set null) |
| `tipo_documento` | `tipoDocumento` | `TD01\|TD04` |
| `anno_progressivo` | `annoProgressivo` (o `anno`) | |
| `progressivo` | `progressivo` | |
| `numero_display` | `${anno_progressivo}/${progressivo}` | convenzione Lira `YYYY/NNN` (CalcoliVari usava `NNN/YYYY`) |
| `data` | `data` | ISO |
| `cliente_snapshot` (JSON) | `clienteSnapshot` | |
| `righe` (JSON) | `righe[]` | `prezzoUnitario`→`prezzo_unitario` |
| `importo` | `totaleLordo` | totale lordo incl. ritenuta (`totaleDocumento`→`totaleDocument` fallback) |
| `ritenuta`/`aliquota_ritenuta`/`tipo_ritenuta`/`causale_ritenuta` | omonimi camel→snake | |
| `contributo_integrativo` | `contributoIntegrativo` | |
| `marca_da_bollo`/`bollo_addebitato` | `marcaDaBollo`/`bolloAddebitato` | bool→0/1 |
| `stato` | `stato` | `bozza\|inviata\|pagata\|stornata` |
| `data_invio_sdi`/`data_pagamento` | omonimi | |
| `pag_mese`/`pag_anno` | `pagMese`/`pagAnno` | |
| `modalita_pagamento` | `modalitaPagamento` | |
| `fattura_originale_id`/`tipo_storno` | `fatturaOriginaleId`/`tipoStorno` | NC TD04 |
| `nc_totale_importo`/`nc_ids` | `ncTotaleImporto`/`ncIds` | |
| `origine` | `origine` | |
| `note` | `note` | |

**Fatture legacy non migrate** (decisione §8.1 = import best-effort): da `data.fatture[mese]` e `_fattureManualeWipedBackup`, solo le entry **non** rappresentate in `fattureEmesse` (no `invoiceId` corrispondente) → riga `fatture` minimale: `importo`←`importo`, riga singola da `desc`, `pag_mese`/`pag_anno`, `stato='bozza'`, `origine='legacy-migrated'`, `progressivo` da **blocco riservato** `9000+idx` nell'anno (evita collisione unique), `anno_progressivo` = anno del doc (o `pagAnno`), `data` (NOT NULL) **sintetizzata** da `pagAnno`/`pagMese` → `${anno}-${pad2(pagMese)||'01'}-01`. **Contate e segnalate** nel report.

### 5.5 `pagamenti` ⭐ recovery-critical
**Sorgente:** `.pagamenti[]` di **tutti** i doc-anno. Shape `{ data, tipo, descrizione, importo, scheduleKey? }`.

| Lira col | ← Sorgente | Trasformazione |
|---|---|---|
| `id` | — | `det(profile\|data\|importo\|tipo\|descrizione\|scheduleKey)` |
| `year` | `scheduleKey` suffisso anno, **else** anno di `data` | **anno di competenza** (NON di cassa): `parseYear(scheduleKey) ?? yearOf(data)` |
| `data` | `data` | ISO (anno di cassa) |
| `tipo` | `tipo` | `tasse\|contributi\|misto\|altro` (Lira ammette anche inail/camera/bollo) |
| `descrizione` | `descrizione` | |
| `importo` | `importo` | |
| `schedule_key` | `scheduleKey` | nullable (i pagamenti manuali ne sono privi) |
| `linked_keys` (JSON) | — | null |

### 5.6 `calendar_entries` — PK `(profile_id, year, month, day)`
**Sorgente:** `data.calendar` = `{ "<mese>-<giorno>": "<code>" }` (sparso, no zero-pad). Parse `"M-D"` → `month`,`day`; `code`→`activity_code`. `''` → skip. Solo entry presenti.

### 5.7 `budget_items`
**Sorgente:** `data.budget[]` = `[{ nome, importo, auto? }]`, ordine = posizione array.

| Lira col | ← Sorgente |
|---|---|
| `id` | `det(profile\|year\|nome\|importo)` |
| `nome`/`importo` | omonimi |
| `auto` | `auto` ? 1 : 0 |
| `ordine` | indice array |

`budgetBaseYear`/`budgetBaseMonth` → **scartati** (no colonna Lira).

### 5.8 `spese`
**Sorgente:** `data.spese[]` = `[{ titolo, costo, deducibilita, anni }]`.

| Lira col | ← Sorgente |
|---|---|
| `id` | `det(profile\|year\|titolo\|costo\|deducibilita\|anni)` |
| `titolo`/`costo`/`deducibilita`/`anni` | omonimi |
| `categoria` | null (no sorgente) |

### 5.9 `dichiarazioni` — PK `(profile_id, year)`
**Sorgente:** `data.dichiarazione` (o legacy `data.lmQuadro` → fondi `overrides`).

| Lira col | ← Sorgente | Note |
|---|---|---|
| `tipo` | `tipoDichiarazione` | `ordinaria\|correttiva\|integrativa` |
| `flags` (JSON) | `flags` `{annoMisto,imposteEstere,altriCrediti}` | |
| `conti_esteri` (JSON) | `contiEsteri[]` | Quadro RW |
| `overrides` (JSON) | `overrides` (+ `lmQuadro.overrides` legacy) + `coniuge`/`familiariCarico` sotto chiave dedicata | evita perdita dati |
| `stato_compilazione` (JSON) | `statoCompilazione` (stringa) | wrap → `{ legacy: <stringa> }` |
| `confirmed_warnings` (JSON) | — | null |

I quadri LM/RR/RS/RX/RW **non** sono importati: in Lira sono **computed** dagli input (`overrides` + `contiEsteri` + year-data).

### 5.10 Scartati esplicitamente (no data loss reale)
`accantonamento` (computed in Lira) · `budgetBaseYear/Month` · flag UI (`icsExported`, `crossYearReminderDismissed`, `adeConservationAcknowledged`, `activeTab`, `sidebarCollapsed`, `theme`) · marker `_fattureManualeWiped` (ma il suo `_…Backup` È letto per le fatture legacy) · `PROFILE_HASHES` (auth sostituita da Argon2id).

---

## 6. Identità & idempotenza

| Entità | Chiave upsert | id Lira |
|---|---|---|
| profiles | `(user_id, slug)` | uuid v4 (lookup-or-create) |
| year_settings | PK `(profile_id, year)` | — |
| clienti | id CalcoliVari (riconcilia unique piva/cf) | riuso id CalcoliVari |
| fatture | `(profile_id, anno_progressivo, progressivo)` | riuso id CalcoliVari |
| pagamenti | firma deterministica | `det(profile\|data\|importo\|tipo\|descrizione\|scheduleKey)` |
| calendar_entries | PK `(profile, year, month, day)` | — |
| budget_items | firma | `det(profile\|year\|nome\|importo)` |
| spese | firma | `det(profile\|year\|titolo\|costo\|deducibilita\|anni)` |
| dichiarazioni | PK `(profile, year)` | — |

`det(parts)` = SHA-256 di `parts.join('|')`, formattato come UUID (8-4-4-4-12) — helper in `identity.ts`, usa `node:crypto`, **nessuna dipendenza nuova**. La firma pagamenti ricalca la dedup nativa di CalcoliVari (`data|importo|tipo|descrizione`) + `scheduleKey` (§8.4).

**Invariante idempotenza:** il `plan` marca `update` **solo** se la riga mappata differisce dalla riga DB. Stesso input applicato due volte ⇒ secondo run = tutti `identical`, **zero scritture**. Test esplicito (§9).

---

## 7. Merge "longest/richer wins"

Più file dello stesso profilo (backup da device diversi) → entità unite **prima** del map:
- **record-by-id** (clienti, fatture): merge per id; per ogni campo, valore non-vuoto/più ricco vince; a parità, record con più campi non-vuoti.
- **array-bag** (pagamenti, budget, spese, calendar): unione per identità deterministica (la firma `det`); pagamenti dedotti per firma.
- **per-anno/scalari** (year_settings, campi profilo): first-non-empty-wins per campo.

Stessa regola vs DB esistente in fase di `plan` (richer-wins su update, identical→skip).

---

## 8. Decisioni-giudizio (confermate dall'utente 2026-06-06)

1. **Fatture legacy non migrate** → import **best-effort** come righe minimali `origine='legacy-migrated'`, contate/segnalate nel report. ✅
2. **`accantonamento` scartato** (computed in Lira). ✅
3. **Dry-run di default**, `--commit` per scrivere. ✅
4. **Firma dedup pagamenti** = `data|importo|tipo|descrizione|scheduleKey` (può fondere versamenti realmente distinti con stessi importo/data/tipo, ma coerente con CalcoliVari). ✅

---

## 9. Validazione, sicurezza & error handling

- **Zod** su ogni riga mappata (riuso/estendo `src/shared/schemas.ts`). Riga invalida → `ImportIssue { entity, sourceKey, reason }`, **mai scartata in silenzio**, riportata nel dry-run.
- **Fail-closed**: con `--commit`, se ci sono issue di validazione l'apply **aborta**; override esplicito `--skip-invalid` (importa solo le valide, scartando le altre **con log**).
- **Transazione unica** in apply: errore DB → **rollback totale** (atomico, niente import parziale).
- **Snapshot pre-import**: prima dell'apply, dump JSON delle righe del profilo target su `tmp/lira-import-snapshot-<profilo>-<ts>.json` (risk-table: "snapshot JSON PRE-import").
- **Dry-run output**: tabella per-entità (insert/update/identical/issue) a stdout + piano dettagliato su `tmp/lira-import-plan-<profilo>.json` → gate "diff manuale prima del commit".
- **Exit code**: `0` ok · `2` issue di validazione presenti (dry-run) · `3` user non trovato · `1` errore generico.

---

## 10. CLI & UX

```
npm run import:legacy -- --user <email> [--slug <slug>] [--commit] [--skip-invalid] <file1.json> [file2.json …]
```
- default = **dry-run** (nessuna scrittura); `--commit` per applicare.
- `--user` deve esistere (altrimenti exit 3 + messaggio che rimanda a `npm run create-user`).
- profilo target: `--slug` o derivato dal nome-profilo dell'export (lowercase), **creato se assente** sotto quell'utente.
- più file ⇒ merge longest-wins (backup multipli dello stesso profilo).

---

## 11. Testing

- **Estrattori** (puri): input raw artigianali con le insidie (pagamenti cross-year, `_fattureManualeWipedBackup`, `lmQuadro`, backup-wrapper, doppio prefisso, calendar sparso) → shape attesa.
- **Mapper** (puri): raw → riga Lira; Zod ok; normalizzazioni (coefficiente %→frazione, camel→snake, bool→0/1); id deterministici stabili.
- **Merge/idempotenza**: due file → longest-wins; **applicare il piano due volte → seconda tutta `identical`** (test idempotenza).
- **Plan/apply** su `createTestDb()`: insert → re-run no-op; fail-closed su invalido; rollback su errore.
- **E2E sintetico**: `calcoli_piva_backup.json` artigianale (formato ufficiale) che copre tutte le 9 entità + variante backup-wrapper → import completo → asserzioni sulle righe DB. Numeri congelati come **golden anchor** (stile Slice 2A, in `src/test-fixtures/`).
- **Opzionale**: se l'utente fornisce un export reale (anche ridotto/anonimizzato) → fixture di validazione aggiuntiva.

---

## 12. Rischi & mitigazioni

| Rischio | Mitigazione |
|---|---|
| Import corrompe/duplica dati | dry-run-first + snapshot pre-import + transazione atomica + idempotenza testata |
| Mapping errato su campo fiscale (es. coefficiente %) | normalizzazioni esplicite + test mapper + golden anchor |
| Fatture legacy a bassa fedeltà inquinano lo storico | `origine='legacy-migrated'` + blocco progressivo riservato + conteggio nel report |
| Dedup pagamenti fonde versamenti distinti | accettato (coerente con CalcoliVari); visibile nel diff dry-run prima del commit |
| Export reale con shape inattesa | fail-closed + `ImportIssue` espliciti, niente drop silenzioso |

---

## 13. Definition of Done

- [ ] `npm run import:legacy -- --user … <file>` (dry-run) produce un piano leggibile per tutte le 9 entità su un export sintetico completo.
- [ ] `--commit` popola il DB; re-run = no-op (idempotente).
- [ ] Merge longest-wins su due backup verificato da test.
- [ ] Backup-wrapper supportato oltre all'export ufficiale.
- [ ] Fail-closed su righe invalide; snapshot pre-import scritto.
- [ ] Suite test verde (estrattori + mapper + merge + plan/apply + e2e sintetico) in aggiunta ai 154 esistenti.
- [ ] `docs/migration-plan.md` Fase 9 aggiornata (importer ✅) e `data-model.md` invariato (nessuna modifica schema in questa slice).
