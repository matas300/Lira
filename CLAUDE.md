# Lira — Project Guide

## Overview
Web app fullstack per Partita IVA italiana, successore di **CalcoliVari** (`C:\Users\matti\Documents\Progetti\Lira\CalcoliVari`). CalcoliVari resta in produzione finché Lira non è completa; nessun lavoro di feature su CalcoliVari (solo bugfix critici).

**Motivazione della riscrittura:**
- localStorage + Firebase Firestore + merge bidirezionale → bug ricorrenti di sync (es. perdita pagamenti al cambio dispositivo).
- Source of truth ambigua (local OR cloud OR merge result).
- ~30 file JS con accessi diretti a `localStorage['calcoliPIVA_*']` → bug di chiave (es. NR-10).
- Auth via SHA-256 hash matching dei profili → non scalabile.

**Filosofia Lira:**
- **Cloud authoritative**: il DB è l'unica source of truth. Niente offline sync bidirezionale.
- **Server-side validation**: schemi Zod condivisi, validazione su API.
- **UI vanilla**: TypeScript + Vite + DOM, no framework. Si porta il dark theme di CalcoliVari (palette Espresso & Mint, sistema Crisp & Tight).
- **Greenfield data model**: riprende la sostanza fiscale di CalcoliVari ma rimuove tutto il legacy (vedi `docs/data-model.md`).

## Architettura

| Layer | Stack |
|---|---|
| Frontend | Vite + TypeScript vanilla + dark theme CSS |
| Backend | Node 22 + Hono (HTTP) |
| ORM | Drizzle (libSQL dialect) |
| DB | Turso (libSQL remoto, free tier ~9GB) |
| Auth | Cookie sessions HTTP-only + Argon2id |
| Validation | Zod (schemi condivisi `src/shared/`) |
| Deploy | Docker → Fly.io `shared-1x-cpu @ 512MB`, region `fra` |

**Perché Turso e non Postgres:** la VM Fly da 512MB serve solo l'app; il DB vive remoto su Turso. SQLite è semplice, backup banale, e il free tier copre 3 utenti a vita.

**Perché vanilla TS e non React/Svelte:** l'utente ama l'UI attuale di CalcoliVari (vanilla). La nuova app deve sentirsi familiare. Vite + TS + ESM modules risolve i veri problemi (globals, chiavi sbagliate) senza introdurre framework.

## Struttura

```
Lira/
├── .claude/
│   └── skills/                          # ereditate da CalcoliVari
│       ├── auditor-fiscale-severo/
│       ├── commercialista-fiscale/
│       ├── dichiarazione-forfettario/
│       └── fatturazione-creator/
├── docs/
│   ├── architecture.md                  # stack, runtime, flussi
│   ├── data-model.md                    # schema DB + razionale
│   └── migration-plan.md                # roadmap da CalcoliVari
├── drizzle/                             # SQL migrations generate
├── public/                              # asset statici frontend
├── scripts/
│   └── import-from-calcolivari.ts       # importer JSON export legacy
├── src/
│   ├── client/                          # Vite SPA
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── lib/
│   │   │   ├── api.ts                   # fetch wrapper
│   │   │   └── auth.ts                  # session helpers
│   │   ├── pages/                       # una funzione per "tab"
│   │   ├── components/                  # widget riutilizzabili
│   │   └── styles/
│   │       ├── tokens.css               # palette + spacing + radii
│   │       └── index.css                # entrypoint
│   ├── server/                          # Hono backend
│   │   ├── index.ts                     # entry HTTP
│   │   ├── db/
│   │   │   ├── client.ts                # libSQL connection
│   │   │   ├── schema.ts                # Drizzle schema
│   │   │   └── migrate.ts               # migration runner
│   │   ├── middleware/
│   │   │   └── auth.ts                  # session middleware
│   │   ├── routes/
│   │   │   ├── auth.ts                  # login/logout/register
│   │   │   ├── profiles.ts
│   │   │   ├── fatture.ts
│   │   │   ├── clienti.ts
│   │   │   ├── pagamenti.ts
│   │   │   ├── scadenziario.ts
│   │   │   └── dichiarazione.ts
│   │   └── lib/
│   │       └── tax-engine.ts            # motore fiscale (port da CalcoliVari)
│   └── shared/                          # condiviso server ↔ client
│       ├── schemas.ts                   # Zod schemas
│       ├── types.ts                     # type aliases derivati
│       ├── forfettario-rules.ts         # costanti fiscali (porta da CalcoliVari)
│       └── ateco-coefficienti.ts        # DM 23/01/2015 (porta da CalcoliVari)
├── .env.example
├── .gitignore
├── CLAUDE.md
├── Dockerfile
├── README.md
├── drizzle.config.ts
├── fly.toml
├── package.json
├── tsconfig.json
├── tsconfig.server.json
└── vite.config.ts
```

## Convenzioni

### File / moduli
- Tutto TypeScript strict (`noUncheckedIndexedAccess` on).
- ESM ovunque (`"type": "module"`).
- Nessun global side-effect: ogni file esporta funzioni/oggetti, non muta state al load.
- Path alias: `@shared/*`, `@server/*`, `@client/*` (vedi `tsconfig.json` + `vite.config.ts`).

### API
- REST sotto `/api/`. JSON in entrambe le direzioni.
- Validazione input/output con Zod via `@hono/zod-validator`.
- Errori: status code HTTP + body `{ error: { code, message, details? } }`.
- Auth: middleware `requireSession` su tutto tranne `/api/auth/login`, `/api/auth/register`, `/api/health`.

### Naming DB
- Snake case nelle colonne (`partita_iva`, `created_at`).
- Camel case nei TypeScript types derivati da Drizzle.
- Primary key: `id` (text/UUID) per entità owned by user; `(profile_id, year)` composite per year-scoped.
- Tutti i timestamp in UTC ISO (`text NOT NULL DEFAULT (current_timestamp)`).

### Sessioni
- Cookie `lira_session` HTTP-only, SameSite=Lax, Secure in prod.
- Session id = UUID v4, lookup in tabella `sessions`.
- TTL: 30 giorni rolling. Refresh su ogni richiesta autenticata.

### Migrations
- Generate con `npm run db:generate` (drizzle-kit).
- Mai modificare migration esistenti: sempre nuova migration per cambi schema.
- In CI/deploy: `npm run db:migrate` prima di avviare il server.

### Test
- Node `--test` nativo (`npm test`).
- Path: `src/**/*.test.ts`.
- Niente Jest. Espressioni con `node:assert/strict` o `expect`-style helper interno (vedi CalcoliVari `test/run-tests.js` per ispirazione, ma in TS qui).

## Concetti fiscali (porta da CalcoliVari)

Vedi anche `src/shared/forfettario-rules.ts` e `docs/data-model.md`. Lista di riferimento:

- **Regimi**: forfettario (RF19, sostitutiva 15% / 5% startup) / ordinario (RF01, IRPEF scaglioni).
- **Soglia ricavi**: 85.000 € accesso (L. 197/2022 art. 1 c. 54), 100.000 € uscita immediata. **Da implementare warning** (rilievo C1 dell'audit 25/05/2026).
- **Coefficienti ATECO**: 9 gruppi (40/54/62/67/78/86%) — DM 23/01/2015.
- **Imposta sostitutiva**: 15% standard / 5% startup primi 5 anni (art. 1 c. 65 L. 190/2014).
- **INPS artigiani/commercianti**: 4 quote fisse + variabile su eccedente. Aliquota 24% / 24,48%. Riduzione 35% solo su comunicazione INPS entro 28/02.
- **INPS Gestione Separata**: 26,07% (no altra cassa) / 24% (con altra cassa). Massimale 2025 ~120.607 €.
- **Acconti** (art. 17 c. 3 DPR 435/2001): `<` 51,65 € no acconto; `51,65 ≤ imposta < 257,52` unico nov 100%; `≥ 257,52` split 40/60.
- **Date scadenze**: saldo+1° acconto 30/6 (proroga eventuale a 31/7 o 30/7 con +0,40%), 2° acconto 30/11, INPS fissi 16/5-20/8-16/11-16/2, bollo trimestrale 31/5-30/9-30/11-28/2.
- **FatturaPA v1.2**: TD01/TD04, RF19/RF01, N2.2 forfettario, soglia bollo 77,47 € strict, IPA 6 char alfanum, no ritenuta forfettario (art. 1 c. 67 L. 190/2014).
- **Dichiarazione PF**: quadri LM/RR/RS/RX/RW. CE non scomputabile da forfettario (art. 165 TUIR).

**Findings audit 25/05/2026** (vedi commit history CalcoliVari + audit doc): da non perdere durante la migrazione. I 5 CRITICI + 6 ALTI andrebbero risolti **by design** in Lira (no warning post-hoc, ma blocchi server-side al boundary).

## Comportamento atteso da Claude

- **Non toccare CalcoliVari** salvo bug bloccanti su tasse/dichiarazione: l'utente sta usandolo per il quotidiano fino al go-live di Lira.
- **Niente legacy carry-over**: se vedi in `src/shared/` un nome con `_legacy_`, `_migration_`, è un errore di design — rimuovere.
- **Server è autoritativo**: nessuna logica fiscale critica solo client. Il client può precalcolare per UX, ma la verità è server-side.
- **No localStorage per dati di dominio**: solo per UI state (es. ultima tab aperta, tema). Mai per fatture/pagamenti/settings fiscali.
- **Sessions su DB**, non JWT — più semplice da revocare, e non serve scalabilità orizzontale.
- **Per modifiche grosse**: aggiorna `docs/architecture.md` e `docs/data-model.md` *prima* di scrivere il codice.

## Skills disponibili

Eredità da CalcoliVari (in `.claude/skills/`):
- `auditor-fiscale-severo` — red team fiscale
- `commercialista-fiscale` — simulatore P.IVA
- `dichiarazione-forfettario` — motore LM/RR/F24
- `fatturazione-creator` — consulente operativo fiscale

## Stato attuale (2026-05-25)

- ✅ Scaffolding repo (questo commit)
- ⏳ Schema DB (`src/server/db/schema.ts`) — bozza iniziale
- ⏳ Hono server entry (`src/server/index.ts`) — bozza iniziale
- ⏳ Frontend entry (`src/client/main.ts`) — bozza iniziale
- ❌ Auth completa
- ❌ Modulo Fatture
- ❌ Modulo Scadenziario
- ❌ Importer da CalcoliVari JSON export
- ❌ Deploy Fly.io test

## Recovery dati da CalcoliVari

I dati storici (fatture, pagamenti, clienti) di Mattia/Peru sono distribuiti tra:
1. **localStorage** dei singoli device → via tab Impostazioni → Esporta JSON
2. **Firebase Firestore** progetto `calcoli-piva` → console.firebase.google.com/project/calcoli-piva/firestore

Lo script `scripts/import-from-calcolivari.ts` (da implementare) accetta uno o più JSON export e li importa nel DB di Lira, con merge "longest wins" per gestire backup multipli.

**Pagamenti persi** (incident 2026-05-25): per recuperarli, scaricare il documento Firestore dal device che li ha ancora, esportare JSON, e darlo in pasto allo script.
