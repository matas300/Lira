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
