# Data Model

## Principi

1. **Single source of truth**: il DB è autoritativo. Niente shadow copy in localStorage / sessionStorage / Firebase.
2. **Profile-scoped**: tutto è `(profile_id, ...)`. Un `user` può possedere più `profiles`.
3. **Year-scoped dove serve**: `year_settings`, `calendar_entries`, `pagamenti`, `dichiarazioni` sono per `(profile_id, year)`. Fatture e clienti vivono al livello profilo (con campi anno computed/indexed).
4. **JSON columns per shape variabili**: anagrafica, righe fattura, conti esteri, overrides dichiarazione — strutture nidificate dove uno schema relazionale puro è overkill. Validate via Zod prima dell'insert.
5. **Soft state assente**: niente `_migration_flag`, `_legacy_backup`, `_synced_at`. Cosa esiste nel DB → è verità.

## Tabelle (Drizzle / libSQL)

### `users`
| col | tipo | note |
|---|---|---|
| id | text PK | UUID v4 |
| email | text UNIQUE | lower-case |
| password_hash | text | Argon2id |
| name | text | display name |
| created_at | text | ISO UTC |
| updated_at | text | ISO UTC |

### `sessions`
| col | tipo | note |
|---|---|---|
| id | text PK | UUID v4, valore del cookie |
| user_id | text FK users | |
| active_profile_id | text FK profiles | profilo selezionato |
| expires_at | text | ISO UTC, TTL 30gg rolling |
| created_at | text | |
| last_used_at | text | rolling refresh |

### `profiles`
| col | tipo | note |
|---|---|---|
| id | text PK | UUID v4 |
| user_id | text FK users | |
| slug | text UNIQUE per user | es. "mattia", "peru" |
| display_name | text | |
| anagrafica | text JSON | `{ cf, nome, cognome, data_nascita, comune_nascita, sesso, residenza: {indirizzo, cap, citta, provincia} }` |
| attivita | text JSON | `{ partita_iva, codice_ateco, comune_domicilio, data_inizio_attivita, regime_default }` |
| giorni_incasso | integer | default 30 |
| created_at | text | |
| updated_at | text | |

### `year_settings`
PK composito `(profile_id, year)`.

| col | tipo | note |
|---|---|---|
| profile_id | text FK | |
| year | integer | |
| regime | text | 'forfettario' \| 'ordinario' |
| coefficiente | real | 0.40 .. 0.86 |
| imposta_sostitutiva | real | 0.05 o 0.15 |
| inps_mode | text | 'artigiani_commercianti' \| 'gestione_separata' |
| inps_categoria | text | 'artigiano' \| 'commerciante' \| null |
| riduzione_35 | integer | 0/1 — applica riduzione INPS (richiede comunicazione entro 28/02) |
| ha_reddito_dipendente | integer | 0/1 |
| limite_forfettario | integer | default 85000 |
| scadenziario_metodo | text | 'storico' \| 'previsionale' |
| primo_anno_fatturato_prec | real | onboarding |
| primo_anno_imposta_prec | real | |
| primo_anno_acconti_imposta_prec | real | |
| primo_anno_contrib_variabili_prec | real | |
| primo_anno_acconti_contrib_prec | real | |
| overrides | text JSON | override manuali scadenziario (saldo/acconto, bollo, INAIL, camera) |

### `clienti`
| col | tipo | note |
|---|---|---|
| id | text PK | UUID v4 |
| profile_id | text FK | |
| nome | text | denominazione o nome+cognome |
| tipo_cliente | text | 'PF' \| 'PG' \| 'PA' \| 'Estero' (default 'PG') |
| partita_iva | text | nullable |
| codice_fiscale | text | nullable |
| codice_sdi | text | 7 char ('0000000' privati, IPA 6 char PA) |
| pec | text | nullable |
| indirizzo | text | |
| cap | text | |
| citta | text | |
| provincia | text | 2 char |
| nazione | text | ISO 2 char (default 'IT') |
| descrizione_standard | text | pre-fill prima riga fattura |
| is_default | integer | 0/1 |
| note | text | |
| created_at | text | |
| updated_at | text | |

### `fatture`
| col | tipo | note |
|---|---|---|
| id | text PK | UUID v4 |
| profile_id | text FK | |
| cliente_id | text FK clienti | nullable per legacy import |
| tipo_documento | text | 'TD01' \| 'TD04' \| 'TD24' (default 'TD01') |
| anno_progressivo | integer | YYYY |
| progressivo | integer | NNN |
| numero_display | text | "YYYY/NNN" computed (denormalizzato per ricerca) |
| data | text | ISO YYYY-MM-DD |
| cliente_snapshot | text JSON | snapshot dati cliente al momento dell'emissione |
| righe | text JSON | array `[{descrizione, quantita, prezzo_unitario, ...}]` |
| importo | real | totale lordo (incl. ritenuta) |
| ritenuta | real | default 0 |
| aliquota_ritenuta | real | |
| tipo_ritenuta | text | RT01-RT06 |
| causale_ritenuta | text | |
| contributo_integrativo | real | default 0 |
| marca_da_bollo | integer | 0/1 |
| bollo_addebitato | integer | 0/1 |
| stato | text | 'bozza' \| 'inviata' \| 'pagata' \| 'stornata' \| 'annullata' |
| data_invio_sdi | text | ISO date |
| data_pagamento | text | ISO date |
| pag_mese | integer | mese di pagamento (per cassa, 1-12) |
| pag_anno | integer | anno di pagamento (cross-year support) |
| modalita_pagamento | text | |
| fattura_originale_id | text FK fatture | per NC TD04 |
| tipo_storno | text | 'parziale' \| 'totale' \| null (per NC) |
| nc_totale_importo | real | default 0 (somma NC su questa fattura) |
| nc_ids | text JSON | array di id NC collegate |
| origine | text | default 'manuale' |
| note | text | |
| created_at | text | |
| updated_at | text | |

### `pagamenti`
| col | tipo | note |
|---|---|---|
| id | text PK | UUID v4 |
| profile_id | text FK | |
| year | integer | anno fiscale (NB: NON anno di pagamento) |
| data | text | ISO YYYY-MM-DD (data effettiva versamento) |
| tipo | text | 'tasse' \| 'contributi' \| 'misto' \| 'altro' \| 'inail' \| 'camera' \| 'bollo' |
| descrizione | text | |
| importo | real | |
| schedule_key | text | nullable, lega al rigo scadenziario (es. 'imposta_acc1_2026') |
| linked_keys | text JSON | array di schedule_key (per pagamenti misti) |
| note | text | |
| created_at | text | |
| updated_at | text | |

### `calendar_entries`
PK composito `(profile_id, year, month, day)`.

| col | tipo | note |
|---|---|---|
| profile_id | text FK | |
| year | integer | |
| month | integer | 1-12 |
| day | integer | 1-31 |
| activity_code | text | '8' (lavoro), 'WE', 'F' (ferie), 'FS' (festivo), 'M' (mezza), etc. |
| updated_at | text | |

### `budget_items`
| col | tipo | note |
|---|---|---|
| id | text PK | |
| profile_id | text FK | |
| year | integer | |
| nome | text | |
| importo | real | |
| auto | integer | 0/1 — true se calcolato (es. "Tasse da accantonare") |
| ordine | integer | per drag-and-drop |
| created_at | text | |
| updated_at | text | |

### `spese`
| col | tipo | note |
|---|---|---|
| id | text PK | |
| profile_id | text FK | |
| year | integer | |
| titolo | text | |
| costo | real | |
| deducibilita | real | 0..1 |
| anni | integer | default 1 (spalmatura) |
| categoria | text | nullable |
| created_at | text | |
| updated_at | text | |

### `dichiarazioni`
PK composito `(profile_id, year)`.

| col | tipo | note |
|---|---|---|
| profile_id | text FK | |
| year | integer | |
| tipo | text | 'ordinaria' \| 'correttiva' \| 'integrativa' |
| flags | text JSON | `{ annoMisto, imposteEstere, altriCrediti }` |
| conti_esteri | text JSON | array per Quadro RW |
| overrides | text JSON | override per-rigo (es. LM3, RR12) |
| stato_compilazione | text JSON | progress tracker step wizard |
| confirmed_warnings | text JSON | array warning keys soppressi |
| created_at | text | |
| updated_at | text | |

## Cosa NON c'è (vs CalcoliVari)

| Eliminato | Motivo |
|---|---|
| `data.fatture[M]` legacy monthly map | Aveva già una migrazione attiva verso `fattureEmesse`; in Lira parte direttamente come tabella `fatture` flat. |
| `accantonamento` keyed object | Era materializzato; in Lira è **computed** da fatture × aliquota effettiva. |
| `_fattureMigratedAt`, `_fattureManualeWipedBackup` | Flag di migrazione one-shot — non servono greenfield. |
| `lmQuadro` legacy | Già migrato a `dichiarazione` in CalcoliVari; qui parte direttamente come `dichiarazioni`. |
| `usaInpsUfficiale` toggle | I parametri INPS sono sempre ufficiali (hard-coded per anno in `shared/inps-params.ts`). Il manuale override era fonte di bug; se serve override puntuale → campo dedicato. |
| `PROFILE_HASHES` SHA-256 + sessionStorage | Sostituito da Argon2id + cookie sessions su DB. |
| `lastModified` per merge bidirezionale | Cloud authoritative: nessun merge. |

## Indici previsti

- `users(email)` UNIQUE
- `sessions(user_id)`, `sessions(expires_at)` per cleanup
- `profiles(user_id, slug)` UNIQUE
- `fatture(profile_id, anno_progressivo, progressivo)` UNIQUE (numerazione)
- `fatture(profile_id, pag_anno, pag_mese)` per query per cassa
- `fatture(profile_id, stato)` per filtro storico
- `pagamenti(profile_id, year)` per query annuali
- `pagamenti(profile_id, schedule_key)` per scadenziario
- `clienti(profile_id, partita_iva)` UNIQUE WHERE partita_iva NOT NULL
- `clienti(profile_id, codice_fiscale)` UNIQUE WHERE codice_fiscale NOT NULL
