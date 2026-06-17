# Slice — Profilo personale + Profilo P.IVA — Design

> Data: 2026-06-17. Parte del build frontend "una pagina alla volta" (port fedele
> da CalcoliVari, niente redesign). Sblocca due delle voci placeholder del menu
> profilo: `/profilo-personale` e `/profilo-piva`.

## Obiettivo

Rendere editabili i dati anagrafici e di attività del **profilo attivo**, oggi
importati ma non modificabili da UI. Due pagine distinte (già route placeholder
nel menu profilo) che condividono backend e logica:

- **Profilo personale** (`/profilo-personale`) → edita `profiles.anagrafica` + `displayName`.
- **Profilo P.IVA** (`/profilo-piva`) → edita `profiles.attivita` + `giorniIncasso`.

## Contesto / stato attuale

- `profiles.anagrafica` e `profiles.attivita` sono colonne **TEXT JSON** (nullable).
  Popolate dall'import CalcoliVari (`import-calcolivari/map.ts`), **mai esposte**
  da API né editabili: `GET /api/profiles` ritorna solo `toPublic`
  (`id, slug, displayName, giorniIncasso`). Nessun endpoint PATCH/PUT.
- `giorniIncasso` è una **colonna top-level** (non JSON), già esposta in `/me`,
  usata come default per le date di pagamento.

### Forma canonica dei blob (fonte: `shared/cedente.ts` + import `map.ts`)

`anagrafica`:
`cf, nome, cognome, sesso, data_nascita, comune_nascita, prov_nascita,
residenza{indirizzo, cap, citta, provincia},
domicilio_fiscale{indirizzo, cap, citta, provincia},
telefono, email, iban, modalita_pagamento`

`attivita`:
`partita_iva, codice_ateco, ateco_gruppo, descrizione_attivita,
comune_domicilio, data_inizio_attivita, regime_default`
(+ `agevolazione_startup`, `primo_anno_agevolato` = **legacy inerti**, nessun
consumo fuori dai test → **non riportati** nel form, regola no-legacy CLAUDE.md).

### Consumatori (perché i campi contano)

- `shared/cedente.ts` (XML FatturaPA) legge `anagrafica.{cf, nome, cognome,
  residenza.*}` + `attivita.partita_iva` → fail-fast se incompleto (blocco duro
  al confine XML, **invariato**).
- `routes/year-settings.ts` e `services/scadenziario-service.ts` leggono
  `attivita.data_inizio_attivita` (boundary check startup 5% + primo anno).

## Decisioni di design

1. **Scope campi: port fedele completo** — tutti i campi del data model in
   entrambi i form (nascita, residenza, domicilio fiscale, recapiti per
   l'anagrafica; P.IVA/ATECO/descrizione/comune/data inizio per l'attività).
2. **Validazione: permissiva + warning di formato** — salva sempre (anche
   parziale/vuoto), ma valida il **formato** quando un campo è compilato
   (P.IVA/CF/CAP/email/provincia malformati → errore inline sul campo, **non
   bloccante**). Nessun campo obbligatorio. Il blocco duro resta al confine XML.
3. **`regime_default` non editabile** — preservato invariato nel round-trip; la
   verità del regime per-anno è `year_settings.regime` (editor in Impostazioni).
   Evita il doppione confondente.
4. **`giorniIncasso` nel form Profilo P.IVA**.
5. **Scoping dal profilo attivo in sessione** — niente slug in URL, niente authz
   extra (coerente con year-settings; 3 utenti, vedi `project_user_scope`).

## Architettura

### Schemi condivisi (`shared/schemas.ts`)

Nuovi Zod:
- `ProfileAnagrafica` — oggetto con tutti i sottocampi **opzionali e stringa
  ammessa vuota** (`residenza`/`domicilio_fiscale` oggetti annidati opzionali).
- `ProfileAttivita` — idem (esclude i legacy inerti; `regime_default` non nello
  schema di input — preservato lato server).
- `ProfilePatchInput` = `{ displayName?, giorniIncasso?, anagrafica?, attivita? }`
  (tutti opzionali; PATCH parziale).

### Backend (`server/routes/profiles.ts`)

- `GET /api/profiles/active` → `{ profile: { id, slug, displayName,
  giorniIncasso, anagrafica, attivita } }`. I blob JSON sono parsati
  (`null`/malformato → `{}`).
- `PATCH /api/profiles/active` (validato `ProfilePatchInput`) → **read-modify-write
  non distruttivo**: i campi presenti aggiornano la colonna; `anagrafica`/`attivita`
  vengono **mergiati** sul blob esistente e ri-serializzati, **preservando**
  `regime_default` e qualsiasi chiave non gestita dal form. Ritorna lo stesso
  shape del GET.
- Profilo target = profilo attivo della sessione.

### Frontend

Pattern identico a `pages/impostazioni.ts`: render puri testabili + `mount` con
fetch/save (`mountPage`, `api`, `esc`).

- **`lib/profile-form.ts`** (logica pura, no DOM, no fetch):
  - `anagraficaDefaults()` / `attivitaDefaults()`,
  - `anagraficaFromResponse()` / `attivitaFromResponse()` (parse difensivo),
  - `anagraficaToBody()` / `attivitaToBody()`,
  - `copyResidenzaToDomicilio(state)` (per il checkbox "uguale a residenza"),
  - validatori di formato che avvolgono `shared/validators`
    (`isValidPartitaIvaIT`, `isValidCodiceFiscaleFormat`, `isValidPec`) + CAP
    (`^\d{5}$`) e provincia (`^[A-Za-z]{2}$`), ognuno tollerante al vuoto.
- **`pages/profilo-personale.ts`**: form anagrafica + `displayName`. Sezioni:
  identificativi (nome, cognome, CF, sesso, data/comune/prov nascita),
  residenza, domicilio fiscale (checkbox "uguale a residenza" copia+nasconde),
  recapiti (telefono, email, IBAN, modalità pagamento). PATCH `{ displayName,
  anagrafica }`.
- **`pages/profilo-piva.ts`**: form attività + `giorniIncasso`. Campi: P.IVA,
  codice ATECO, descrizione attività, gruppo ATECO (select da `atecoGruppiUI()`),
  comune domicilio, data inizio attività (nota + link a `/impostazioni` per il
  nesso startup 5%), giorni incasso. PATCH `{ giorniIncasso, attivita }`.
- Routing (`main.ts`): le due route smettono di montare `placeholder` e montano
  le nuove pagine.

### Errori / edge

- Profilo con blob vuoti (nessun import) → form coi default vuoti, nessun banner
  d'errore.
- PATCH 400/422 → messaggio inline accanto al pulsante Salva.
- Blob JSON malformato in DB → trattato come `{}` (no crash).
- Warning di formato non bloccano il salvataggio.

## Test

- `lib/profile-form.test.ts`: defaults, `*FromResponse`/`*ToBody` round-trip,
  `copyResidenzaToDomicilio`, preservazione `regime_default`, validatori
  (vuoto OK, formato sbagliato segnalato).
- `pages/profilo-personale.test.ts` / `pages/profilo-piva.test.ts`: render puri
  (presenza campi, sezioni, select ATECO, checkbox domicilio).
- `routes/profiles.test.ts`: `GET active` (parse blob), `PATCH` merge parziale
  non distruttivo (preserva `regime_default` e chiavi extra), blob malformato → `{}`.

## Fuori scope

- Regime ordinario (resta non supportato).
- Creazione/eliminazione profili (esiste già `POST /api/profiles`; non toccata).
- Backfill `tariffa_giornaliera` o altri campi da Firestore.
- Riepilogo e Dichiarazione (slice successivi).
