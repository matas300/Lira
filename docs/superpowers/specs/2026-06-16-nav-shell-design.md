# Lira frontend — Slice "Nav shell" (design)

Data: 2026-06-16

## Contesto

L'app Lira è deployata e con i dati reali importati, ma il frontend è incompleto:
la dashboard mostra il placeholder "Le funzioni fiscali arriveranno negli slice
successivi", la sidebar ha solo 4 voci (2 disabilitate) e su desktop appare
**sia la sidebar sia la bottom-nav** (bug CSS). L'utente vuole un'unica
navigazione a sidebar — su desktop e mobile — come la vecchia CalcoliVari, e poi
le pagine fiscali costruite una alla volta.

Principio guida del progetto: **replica fedele di CalcoliVari, niente redesign**
(vedi memoria `feedback_no_redesign`). Ogni pagina è un *port* della
corrispondente CalcoliVari sullo stack Lira; il backend esiste già dove indicato.

## Decomposizione complessiva (per contesto, NON tutto in questo slice)

1. **Nav shell** ← QUESTO SLICE
2. Regime Forfettario (home, usa route `tax`)
3. Scadenze (route `scadenziario`, già pronta lato server)
4. Tasse Accantonate
5. Dichiarazione (route `dichiarazione`)
6. Calendario
7. Budget

Ogni pagina = proprio ciclo spec→plan→execute, mergiata e verificata sull'app
live prima della successiva.

## Obiettivo dello slice Nav shell

Sostituire topbar + bottom-nav con un'unica **sidebar** (desktop e mobile) che
rispecchia la struttura di CalcoliVari, predisporre il routing per tutte le voci
(con placeholder pulito per le pagine non ancora fatte), aggiungere il favicon.

## In scope

- Riscrittura `src/client/components/sidebar.ts`
- Modifica shell `src/client/lib/dom.ts` (rimozione topbar + bottom-nav)
- CSS `src/client/styles/components.css` (sidebar a ogni larghezza, no bottom-nav)
- Routing `src/client/main.ts` (8 voci + placeholder)
- Stato anno globale (helper nuovo, es. `src/client/lib/year.ts`)
- Favicon (`public/favicon.svg` + `<link>` in `index.html`)
- Eliminazione `components/header.ts` e `components/bottom-nav.ts`
- Test unit

## Fuori scope

- Contenuto reale delle pagine fiscali (slice successivi)
- Aggancio dello stato-anno alle pagine esistenti oltre il minimo (Fatture verrà
  agganciato nel suo slice; qui il selettore esiste e persiste, ma non si
  pretende che ogni pagina lo rispetti già)
- Modifiche al backend

## Design

### Sidebar (`sidebar.ts`)

- **Brand header**: logo `€` (gradiente `--color-primary`→`--color-tertiary`),
  "Lira / Partita IVA", e **selettore anno** compatto `‹ {anno} ›` accanto al
  brand (in alto, come CalcoliVari).
- **Sezioni e voci** (`NAV_ITEMS` con `section`, `route`, `label`, `icon` SVG
  stroke portate da CalcoliVari):
  - *Principale*: Regime Forfettario `/`, Tasse Accantonate `/tasse`,
    Scadenze `/scadenze`, Calendario `/calendario`
  - *Documenti*: Fatture `/fatture`, Budget `/budget`, Clienti `/clienti`,
    Dichiarazione `/dichiarazione`
  - Tutte le voci sono **abilitate** (puntano a una route reale). Niente più
    `route: null`.
- **Footer**: avatar+nome profilo, `<select>` switch profilo, bottone "Esci",
  bottone collassa. (Logica spostata qui da `header.ts`.)
- Stato attivo: voce evidenziata mint quando `route === activeRoute`.
- Funzioni esportate: `renderSidebar(me, activeRoute, year)` → HTML;
  `wireSidebar(container, { onProfileChange, onYearChange })` → cleanup
  (cabla collapse, switch profilo, logout, frecce anno).

### Shell (`dom.ts`)

`mountPage` rende solo `sidebar + main`. Rimossi `renderHeader` e
`renderBottomNav` (e relativi import). `wireSidebar` riceve i callback per
re-render (switch profilo) e cambio anno.

### Routing e placeholder (`main.ts` + nuova pagina placeholder)

- Registra le route per tutte le 8 voci.
- Le pagine non ancora implementate (Regime Forfettario, Tasse Accantonate,
  Scadenze, Calendario, Budget, Dichiarazione) montano una pagina placeholder
  condivisa `pages/placeholder.ts` (usa `mountPage`), che mostra una card
  sobria: titolo della sezione + "Pagina in costruzione". Così ogni voce è
  navigabile e la sidebar resta coerente.
- Le route già implementate (Fatture, Clienti) restano invariate.
- Nota: la home `/` ora è "Regime Forfettario" placeholder; la vecchia
  `dashboard.ts` viene sostituita dal placeholder finché lo slice 2 non la
  implementa.

### Stato anno (`lib/year.ts`)

- `getYear(): number` — legge `localStorage['lira_year']`, default = anno
  corrente.
- `setYear(y: number): void` — persiste.
- Le frecce `‹ ›` chiamano `setYear` e triggerano un re-render della pagina
  corrente. È UI-state (ammesso da CLAUDE.md, mai dati di dominio).
- Range ragionevole (es. 2017..annoCorrente+1) per non andare fuori dai dati.

### CSS (`components.css`)

- Sidebar visibile a **ogni** larghezza: si toglie il gate
  `@media (min-width: 900px)` attorno alle regole sidebar/app-shell (diventano
  base). `.sidebar { display:none }` rimosso.
- `.bottom-nav` e `.app-header` rimossi (o le regole orfane ripulite).
- `.app-shell` ha sempre `padding-left` = larghezza sidebar (60px se collassata).
- **Mobile (<700px)**: la sidebar parte **collassata** alla rail 60px se non
  c'è preferenza salvata; l'utente la espande col bottone. Logica in
  `wireSidebar` (controlla `matchMedia` + assenza di `localStorage` pref).

### Favicon

- `public/favicon.svg`: quadrato arrotondato, gradiente `mint→rosa`, "€" centrale
  (coerente col logo sidebar).
- `index.html`: `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />`,
  `<title>Lira</title>` invariato.

## Error handling

- Switch profilo fallito: log in console, nessun crash (come oggi).
- Logout fallito: come oggi.
- Anno fuori range: clamp al range valido.

## Testing (`node --test`, vanilla)

- `sidebar.test.ts`: `renderSidebar` produce le 2 sezioni, le 8 voci con le route
  giuste, lo stato attivo corretto, il selettore anno col valore passato; footer
  con nome profilo + opzioni switch.
- `year.test.ts`: `getYear` default = anno corrente quando storage vuoto;
  `setYear`/`getYear` round-trip; clamp fuori range.
- `placeholder` / routing: la route di una pagina non implementata risolve alla
  pagina placeholder (test del resolver di `main.ts` se fattorizzabile).
- Le funzioni di rendering ritornano stringhe HTML → testabili senza DOM reale;
  per il wiring si usa un container jsdom-like minimale già in uso nel progetto
  se presente, altrimenti si testano solo le funzioni pure di render.

## Rischi / note

- Eliminare `header.ts`/`bottom-nav.ts`: verificare che nessun altro modulo li
  importi (grep prima della rimozione).
- Lo stato-anno qui è introdotto ma agganciato alle pagine solo nei loro slice;
  va evitato di rompere Fatture/Clienti (che oggi non usano l'anno).
