# Slice 1 — Menu profilo + Impostazioni (editor parametri) + Tema — Design

Data: 2026-06-17
Stato: approvato (in attesa di piano di implementazione)

## Contesto e decomposizione

L'utente vuole un **menu profilo** nel footer della sidebar (stile CalcoliVari:
Riepilogo / Profilo personale / Profilo P.IVA / Impostazioni / Tema / Logout) e
l'editor dei parametri fiscali sotto **Impostazioni** — NON in home page.

"Menu completo" implica 4 destinazioni distinte (Riepilogo, Profilo personale,
Profilo P.IVA, Impostazioni) + Tema, troppe per una sola spec. Decomposizione
concordata:

| # | Slice | Contenuto |
|---|---|---|
| **1 (questo)** | Menu profilo + Impostazioni + Tema | Popup footer con tutte le voci; **Impostazioni** = editor `year_settings`; **Tema** dark/light; Logout (esiste). Le 3 voci pesanti → placeholder. |
| 2 | Profilo personale | Form su `profiles.anagrafica` + route PATCH |
| 3 | Profilo P.IVA | Form su `profiles.attivita` (ateco, data inizio…) + PATCH |
| 4 | Riepilogo | Overview annuale (overlap con Regime) — brainstorm dedicato |

Questa spec copre SOLO lo Slice 1. È **frontend-only**: il backend
`GET/PUT /api/year-settings/:year` esiste già (con boundary check fiscali in
`assertValidYearSettings`). Si aggiunge un piccolo modulo tema (UI-state).

## A. Menu profilo (footer sidebar)

Oggi il footer di `components/sidebar.ts` ha: link profilo → `/profiles`, una
`<select>` di switch profilo, bottoni "Esci" + collassa. Si sostituisce con:

- **Trigger**: riga avatar + nome profilo (come oggi) che apre/chiude un **popup
  menu** ancorato sopra il footer.
- **Voci del menu** (in ordine):
  - **Riepilogo** → placeholder (badge "presto")
  - **Profilo personale** → placeholder ("presto")
  - **Profilo P.IVA** → placeholder ("presto")
  - **Impostazioni** → naviga a `/impostazioni`
  - **Tema** → toggle dark/light inline (mostra il valore corrente: "scuro"/"chiaro"), NON naviga
  - **Logout** → logout esistente
- **Switch profilo**: la `<select>` di switch profilo resta, posizionata dentro
  il popup (sopra le voci o in testa), quando `me.profiles.length > 1`. Mantiene
  `switchProfile` + `onChanged`.
- **Bottone collassa sidebar**: resta nel footer, fuori dal popup.
- **Interazione**: click sul trigger → toggle popup; click fuori dal popup →
  chiude; `Escape` → chiude. Il popup è chiuso di default a ogni render.
- **Accessibilità**: trigger `aria-haspopup="menu"` + `aria-expanded`; voci come
  `role="menuitem"`; voci placeholder `aria-disabled="true"`.

Le voci placeholder navigano a route che montano `pages/placeholder.ts`
(`/riepilogo`, `/profilo-personale`, `/profilo-piva`) così il menu è completo e
navigabile; saranno sostituite dai rispettivi slice.

`/profiles` (gestione/creazione profili) resta una route raggiungibile
(non rimossa), ma non è una voce del menu in questo slice.

## B. Pagina Impostazioni (`/impostazioni`)

Nuova route in `main.ts` → `pages/impostazioni.ts`. **Non** è in `NAV_SECTIONS`
(si raggiunge solo dal menu profilo). Year-scoped via `getYear()`.

### Comportamento
- `mount()` fetch `GET /api/year-settings/:year`.
  - **200** → form precompilato coi valori correnti.
  - **404** (`YEAR_SETTINGS_NOT_FOUND`) → form coi **default** (anno non ancora
    configurato): regime forfettario, coefficiente 0.78, sostitutiva 0.15, INPS
    gestione_separata, riduzione35 0, haRedditoDipendente 0, limite 85000,
    scadenziarioMetodo 'storico', resto null. Mostra un avviso "Anno non ancora
    configurato".
- Stato locale del form, modificato in-place.
- **"Salva parametri"** → `PUT /api/year-settings/:year` con il body completo
  (`YearSettingsInput`). Su **200** → messaggio di conferma + form aggiornato coi
  valori salvati (echo). Su **400/422** → mostra `error.message` inline (es.
  COEFFICIENTE_NON_AMMESSO, INVALID_SOSTITUTIVA_5, PROROGA_FUORI_LUGLIO,
  REGIME_NOT_SUPPORTED).
- **"Annulla"** → ripristina i valori dall'ultimo fetch (reset del form).

### Campi — core (sempre visibili)
- **Regime**: toggle Forfettario / Ordinario; **Ordinario disabilitato** con nota
  "non ancora supportato" (il server risponde 422 REGIME_NOT_SUPPORTED).
- **Coefficiente ATECO**: `<select>` costruito da `ATECO_GROUPS` di
  `@shared/ateco-coefficienti` (label → coefficiente come value). Pre-seleziona
  il primo gruppo con `coefficiente` uguale a quello salvato; mostra il %
  memorizzato come hint. Il body salva `coefficiente` (number).
- **Imposta sostitutiva**: segmento 15% (0.15) / 5% startup (0.05).
- **INPS**: `inpsMode` (gestione_separata / artigiani_commercianti); se
  artigiani_commercianti mostra `inpsCategoria` (artigiano / commerciante),
  altrimenti `inpsCategoria = null`.
- **Riduzione 35%**: checkbox `riduzione35`; se attiva mostra `riduzione35Comunicata`
  (checkbox) e `riduzione35DataComunicazione` (date, opzionale).
- **Reddito da dipendente**: checkbox `haRedditoDipendente`.
- **Limite forfettario**: number, default 85000.
- **Tariffa giornaliera**: number opzionale (`tariffaGiornaliera`, nullable);
  condivisa con il picker calendario (Slice B).

### Campi — avanzate (sezione collassabile, chiusa di default)
- **Metodo scadenziario**: `scadenziarioMetodo` (storico / previsionale).
- **Proroga saldo**: `prorogaSaldoAt` (date, opzionale; solo luglio — il server
  valida PROROGA_FUORI_LUGLIO).
- **Dati primo anno previsionale** (5 number opzionali): `primoAnnoFatturatoPrec`,
  `primoAnnoImpostaPrec`, `primoAnnoAccontiImpostaPrec`,
  `primoAnnoContribVariabiliPrec`, `primoAnnoAccontiContribPrec` (5 campi reali —
  tutti i `primoAnno*` di `YearSettingsInput`).

`overrides` NON è esposto (campo interno per confirmedWarnings).

### Validazione
Solo lato client validazione di forma leggera (campi numerici, required dove
serve). La validazione fiscale è **server-side** (`YearSettingsInput` Zod +
`assertValidYearSettings`); gli errori 400/422 si mostrano inline. Nessuna logica
fiscale duplicata sul client.

### Integrazione con le CTA needsConfig
Le CTA "Configura l'anno" oggi puntano in modo incoerente (regime.ts → `/tasse`,
tasse.ts/budget.ts → `/`). Si allineano TUTTE a **`/impostazioni`**.

## C. Tema (dark/light)

- Nuovo modulo `lib/theme.ts`: `getTheme()` / `setTheme()` / `applyTheme()` /
  `toggleTheme()`. Stato in `localStorage` chiave `lira_theme` ('dark' | 'light'),
  default 'dark'. Applica impostando `document.documentElement.dataset.theme`.
- Applicato al boot (in `main.ts`, prima del primo render).
- La voce "Tema" del menu chiama `toggleTheme()` e ri-renderizza la sidebar
  (per aggiornare l'etichetta "scuro"/"chiaro").
- I token light esistono già in `tokens.css` (`html[data-theme="light"]`).

## File

- Modifica `src/client/components/sidebar.ts`: footer con trigger + popup menu;
  wiring open/close (click-fuori, Esc), voce Tema, navigazione voci. Mantiene
  switch profilo + collassa + logout.
- Crea `src/client/pages/impostazioni.ts`: render puri del form + `mount()`
  (fetch year-settings, save, errori, reset). Riusa `mountPage`.
- Crea `src/client/lib/year-settings-form.ts`: logica pura testabile — `defaults()`,
  `bodyFromState(state)` (costruisce il `YearSettingsInput`), `atecoOptions()` e
  mapping coefficiente↔gruppo, `stateFromResponse(resp)`.
- Crea `src/client/lib/theme.ts`: gestione tema (puro/iniettabile per i test).
- Modifica `src/client/main.ts`: route `/impostazioni`, `/riepilogo`,
  `/profilo-personale`, `/profilo-piva` (placeholder); applica tema al boot.
- Modifica `src/client/pages/regime.ts`, `tasse.ts`, `budget.ts`: CTA needsConfig
  → `/impostazioni`.
- Modifica `src/client/styles/index.css`: stili menu popup + pagina impostazioni.

## Test

- `lib/year-settings-form.test.ts` (puro): `defaults()` coerenti; `bodyFromState`
  costruisce un body valido (incl. inpsCategoria null quando gestione_separata,
  riduzione comunicata/data solo se riduzione attiva); mapping coefficiente→gruppo
  e pre-selezione; `stateFromResponse` round-trip.
- `lib/theme.test.ts` (puro, storage iniettabile): default 'dark', toggle, persist,
  applyTheme imposta il dataset.
- `pages/impostazioni.test.ts` (render puri): campi core presenti, ordinario
  disabilitato, sezione avanzate collassata, pre-selezione coefficiente, sezione
  riduzione condizionale.
- `components/sidebar.test.ts` (se esiste, estendere; altrimenti render puro):
  il footer contiene il trigger e le 6 voci; placeholder marcate.

## Fuori scope (slice successivi)

- Profilo personale (anagrafica), Profilo P.IVA (attivita), Riepilogo.
- Supporto regime ordinario (slice 2B).
- Editor `overrides`/confirmedWarnings.
- Sincronizzazione tema con `prefers-color-scheme` (si parte da default 'dark').
