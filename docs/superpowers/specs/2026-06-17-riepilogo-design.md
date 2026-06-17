# Slice — Riepilogo (cruscotto cross-modulo) — Design

> Data: 2026-06-17. Parte del build frontend "una pagina alla volta" (port fedele
> da CalcoliVari, niente redesign). Sblocca la voce placeholder `/riepilogo` del
> menu profilo. Penultima pagina; resta solo Dichiarazione.

## Obiettivo

Trasformare `/riepilogo` in un **cruscotto cross-modulo**: una overview annuale che
aggrega a colpo d'occhio i moduli e funge da punto d'ingresso, con ogni card che
linka alla pagina dedicata.

## Contesto / motivazione del confine

In CalcoliVari la tab "Riepilogo" (`renderRiepilogoForfettario` in `app-calcolo.js`)
mostra: sintesi netto/lordo/imposta/INPS/% effettiva, Base Fiscale (formula),
Storico vs Previsionale, Warning, andamento mensile + contributi. **Lira ha già
portato tutto questo nella pagina Regime (`/`)**, che è il port unificato di
"Calcolo + Riepilogo" di CalcoliVari (vedi `src/client/pages/regime.ts`).

Un port 1:1 del Riepilogo sarebbe quindi ~95% duplicato di Regime. Decisione presa
(brainstorm dedicato): `/riepilogo` diventa un **cruscotto** che NON ri-deriva il
calcolo fiscale di dettaglio (resta su Regime) ma offre una panoramica sintetica
multi-modulo + le CTA di navigazione. Niente duplicazione: Regime = dettaglio
fiscale, Riepilogo = punto di partenza.

## Architettura

**Frontend-only, nessun endpoint nuovo, nessuna migration.** Tutti i dati sono già
esposti. Due fetch in parallelo (`Promise.allSettled`):
- `GET /api/tax/scenario?year=YYYY` → alimenta le card 1 (Sintesi fiscale) e 2
  (Fatturato + limite). Shape già usato da `regime.ts` (`ScenarioResponse`:
  `year, needsConfig, grossCollected?, limite?, nettoAnnuo?, comparison?, monthly?`).
- `GET /api/scadenziario/:year` → alimenta la card 3 (Prossime scadenze). Shape
  `ScadenziarioView` (vedi `scadenze.ts`): `rows[]` con `dueDate`, `amount.point`,
  `paidTotal`, `status`, `title`; `summary.totalResidual`.

Pagina `src/client/pages/riepilogo.ts`, pattern `impostazioni.ts`/`regime.ts`:
funzioni di render **pure** (ricevono dati, ritornano HTML, testabili senza DOM) +
`mount()` che esegue i due fetch e compone. Anno dal selettore (`getYear()`). Ogni
valore dinamico passa per `esc()`.

### Riuso
- `scadenzaTiming(dueDateIso, today)` da `src/client/lib/scadenza-timing.ts` per i
  chip di timing nella card scadenze.
- Formattatori locali `eur()`/`pct()` coerenti con i siblings (il codebase li
  duplica per-pagina, non sono estratti — si mantiene la convenzione).
- La logica della barra limite è replicata in forma compatta (la `renderLimitBar`
  di `regime.ts` è page-local, non un componente condiviso; YAGNI estrarla per un
  solo riuso).

## Componenti

### Funzione pura `prossimeScadenze(rows, n)`
Esportata da `riepilogo.ts`, testabile. Seleziona le prossime scadenze da pagare:
- residuo = `amount.point - paidTotal`; tiene solo le righe con residuo > 0
  (~0.01 di tolleranza);
- ordina per `dueDate` crescente;
- ritorna le prime `n` (N=4).

### Render puri
- `renderSintesiCard(selected, grossCollected, nettoAnnuo)` — Totale annuo lordo,
  Imposta sostitutiva, Contributi INPS, Netto annuo, Netto mensile, % effettiva
  (`(imposta+inps)/lordo`). Footer-link "Dettaglio fiscale →" a `/`.
- `renderLimitCard(grossCollected, limite)` — incassato dell'anno + barra di
  avvicinamento alla soglia (default 85.000 €): ≥80% giallo, ≥100% rosso con nota
  decadenza (uscita immediata oltre 100k, decadenza dall'anno dopo oltre 85k).
  Link "Fatture →" a `/fatture`.
- `renderScadenzeCard(prossime, totalResidual)` — lista delle N righe (titolo, data,
  importo residuo, chip timing) + "Residuo totale anno". Link "Scadenze →" a
  `/scadenze`. Stato vuoto se nessuna scadenza da pagare.
- `renderDichiarazioneCta()` — banner/bottone "Apri Dichiarazione" → `/dichiarazione`.
- `renderConfigPrompt(year)` — prompt compatto "Configura il `<anno>`" → `/impostazioni`
  (riusato dalle card fiscali in stato needsConfig).
- `renderPage(...)` — intestazione "Riepilogo `<anno>`" + griglia delle card.

### `mount(container)`
`mountPage({ container, route: '/riepilogo', render })`. Nel render:
1. stato di caricamento;
2. `Promise.allSettled([api.get(scenario), api.get(scadenziario)])`;
3. compone le card secondo gli esiti (vedi error handling);
4. `today` = data ISO odierna (browser) per i chip timing.

## Data flow

```
getYear() ─┬─ GET /api/tax/scenario?year ─→ ScenarioResponse ─┬─ renderSintesiCard
           │                                                   └─ renderLimitCard
           └─ GET /api/scadenziario/:year ─→ ScadenziarioView ─→ prossimeScadenze(rows,4) ─→ renderScadenzeCard
                                                                  summary.totalResidual ──┘
renderDichiarazioneCta  (statico)
```

## Error handling / needsConfig (per-card, fetch indipendenti)

- `scenario` rifiutato, oppure `scenario.needsConfig === true` / `comparison` assente
  → card 1 e 2 sostituite da `renderConfigPrompt(year)`.
- `scadenziario` rifiutato → card 3 mostra un messaggio di errore locale; se risolve
  ma senza righe da pagare → stato vuoto "Nessuna scadenza da pagare".
- Il fallimento di un fetch non abbatte le altre card (`allSettled`).
- La CTA Dichiarazione è sempre presente (statica).

## Test

- `prossimeScadenze()`: filtra le righe saldate (residuo ≤ 0), ordina per data, taglia
  a N; residuo calcolato come `amount.point - paidTotal`.
- Render puri: presenza dei valori in `renderSintesiCard`; barra/percentuale e nota
  soglia in `renderLimitCard` (sotto-soglia, ≥80%, ≥100%); chip + righe + stato vuoto
  in `renderScadenzeCard`; link corretti (`data-route`) in tutte le card; CTA
  Dichiarazione; `renderConfigPrompt` punta a `/impostazioni`.

## Fuori scope

- Tasse accantonate vs versate, Budget, Clienti (esclusi dal cruscotto).
- Nessun endpoint nuovo; nessuna migration.
- Donut, formula, storico/previsionale, breakdown INPS, tabella mensile: restano
  sulla pagina Regime, non duplicati qui.
- Dichiarazione (slice successivo, l'ultimo).
