# Lira

App fullstack per Partita IVA italiana — successore di CalcoliVari.

Vedi [`CLAUDE.md`](./CLAUDE.md) per panoramica completa, [`docs/architecture.md`](./docs/architecture.md) per il runtime, [`docs/data-model.md`](./docs/data-model.md) per lo schema.

## Primo setup (dev locale)

```bash
# 1. Installa dipendenze
npm install

# 2. Configura env (dev locale usa SQLite file)
cp .env.example .env
# .env è già pronto con DATABASE_URL=file:./local.db

# 3. Applica migrations
npm run db:migrate

# 4. Crea il primo utente + profilo default (in transazione)
npm run create-user -- matas300@gmail.com 'PasswordSicuraQui' 'Mattia'

# 5. (Opzionale) Aggiungi un secondo profilo allo stesso utente
npm run create-profile -- matas300@gmail.com peru 'Peru'

# 6. Avvia dev server (Hono + Vite)
npm run dev
# → web: http://localhost:5173
# → api: http://localhost:8787
```

## Primo setup (Turso remoto)

Solo se vuoi puntare a un DB remoto in dev/staging/prod.

```bash
# Installa Turso CLI (una tantum)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login

# Crea DB
turso db create lira-prod --location fra
turso db tokens create lira-prod --expiration none
# Output → copia in .env:
# DATABASE_URL=libsql://lira-prod-<org>.turso.io
# DATABASE_AUTH_TOKEN=<jwt>

npm run db:migrate
npm run create-user -- ...
```

## CLI admin

| Comando | Cosa fa |
|---|---|
| `npm run create-user -- <email> <password> [name]` | Crea user + profilo `default` in una transazione |
| `npm run create-profile -- <email> <slug> <displayName>` | Aggiunge un profilo a un user esistente |
| `npm run reset-password -- <email> <newPassword>` | Resetta la password e invalida tutte le sessioni dell'utente |

Non esiste un endpoint HTTP pubblico per creare/registrare utenti: l'app è privata.

## Test

```bash
npm test           # tutti i test (integration + unit)
npm run typecheck  # tsc --noEmit
```

## Build produzione

```bash
npm run build      # build:web (Vite) + build:server (tsc)
npm start          # node dist/server/index.js
```

## Stack

Vedi `docs/architecture.md`. Riassunto: Vite + TS vanilla → Hono (Node 22) → Drizzle → libSQL (file:// o Turso). Cookie sessions HTTP-only + Argon2id. Deploy target: Fly.io 512MB.

## Modulo fiscale (Slice 2A — forfettario)

Slice 2A introduce il motore fiscale forfettario + lo scadenziario annuale
(13 righe canoniche: 3 sostitutiva, 3 contributi variabili, 4 INPS fissi,
2 bollo, 1 camera commercio). Logica fiscale pura in `src/server/lib/` (no I/O),
orchestrazione DB in `src/server/services/scadenziario-service.ts`.

### Endpoint API

| Gruppo | Metodi | Note |
|---|---|---|
| `/api/year-settings/:year` | GET, PUT, PATCH `/warnings` | impostazioni annuali (regime, coefficiente ATECO, INPS, riduzione 35%, proroga); boundary fiscali A1/A5 lato server |
| `/api/pagamenti` | GET `?year=`, POST, POST `/quick-pay`, PATCH `/:id`, DELETE `/:id` | CRUD pagamenti + quick-pay agganciato a `scheduleKey` parseabile |
| `/api/scadenziario/:year` | GET | `ScadenziarioView` completa: 13 righe + `methodComparison` storico↔previsionale + `transition` + `warnings` |
| `/api/tax` | GET `/rules?year=`, POST `/simulate` | catalogo costanti (INPS_ARTCOM, INPS_GS, ACCONTO_RULES, FORFETTARIO_RULES) + simulazione what-if pura |

### Audit fix integrati by-design

Lo slice risolve 7 finding dell'audit 25/05/2026 senza warning post-hoc,
bensì come boundary server-side o invarianti negli engine puri:

- **C1** (soglia 85k/100k): `evaluateAuditChecks` → warning `C1_SOGLIA_85K_SUPERATA` (info) o `C1_CESSAZIONE_IMMEDIATA` (block) basato su `grossCollected` reale.
- **C3** (slittamento uniforme weekend/festivi): tutte le date non prorogabili passano da `buildRolledDueDate` in `@shared/date-rules` — nessun codepath bypassa.
- **A1** (5% startup ≤ 5 anni): boundary `PUT /api/year-settings/:year` → 422 `INVALID_SOSTITUTIVA_5` se `data_inizio_attivita` è oltre i 5 periodi d'imposta (art. 1 c. 65 L. 190/2014).
- **A5** (proroga saldo+acc1): `prorogaSaldoAt` deve essere in luglio (boundary 422 `PROROGA_FUORI_LUGLIO`); si propaga solo a saldo + acc1 sostitutiva + saldo + acc1 contributi + camera, mai a acc2/INPS fissi/bollo.
- **A6** (acconti reali vs stimati): il saldo dell'anno N sottrae gli acconti VERSATI nell'anno N-1 (pagamenti puri + linkedKeys breakdown), non quelli pianificati.
- **M1** (riduzione 35% non comunicata): warning runtime `M1_RIDUZIONE_35_NON_COMUNICATA` quando `riduzione35=1` ma `riduzione35Comunicata=0`.
- **M3** (acconti minimi): costanti in `@shared/acconto-rules` (no acconto < 51,65 €; rata unica 51,65 ≤ x < 257,52; split 40/60 ≥ 257,52 — art. 17 c. 3 DPR 435/2001) applicate in `buildAccontoPlan`.

### Esempio: login → scadenziario

```bash
# 1. Login (memorizza cookie di sessione in cookies.txt)
curl -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"matas300@gmail.com","password":"PasswordSicuraQui"}' \
  -c cookies.txt

# 2. Scadenziario 2026 (riusa cookie)
curl http://localhost:8787/api/scadenziario/2026 -b cookies.txt | jq
```

### Smoke E2E

`scripts/smoke-scadenziario.ts` esegue end-to-end il motore senza server HTTP
(DB temporaneo + utente + year_settings + fattura → `buildScadenziarioView` →
stampa JSON con `rowsCount: 13` e summary aggregato):

```bash
npx tsx scripts/smoke-scadenziario.ts
```
