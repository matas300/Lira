# Lira

Web app per Partita IVA italiana — successore di [CalcoliVari](https://github.com/matas300/CalcoliVari).

> **Stato:** scaffold iniziale (2026-05-25). CalcoliVari resta in produzione finché Lira non è completa.

## Architettura

- **Backend**: Node 22 + Hono + Drizzle ORM
- **Database**: Turso (libSQL/SQLite remoto, free tier ~9GB)
- **Frontend**: Vite + TypeScript vanilla (no framework, dark theme portato da CalcoliVari)
- **Auth**: cookie sessions HTTP-only + Argon2id (no JWT)
- **Validation**: Zod (schemi condivisi server/client)
- **Deploy**: Docker su Fly.io (shared-1x-cpu @ 512MB)

## Setup locale

```bash
# 1. Dipendenze
npm install

# 2. Variabili d'ambiente
cp .env.example .env
# poi compila SESSION_SECRET, DATABASE_URL, DATABASE_AUTH_TOKEN

# 3. Database (dev locale: SQLite file)
# - DATABASE_URL=file:local.db   per sviluppo offline
# - DATABASE_URL=libsql://...    per Turso cloud
npm run db:generate    # crea migrations da schema.ts
npm run db:migrate     # applica migrations

# 4. Dev (server + frontend hot reload in parallelo)
npm run dev
```

Server: http://localhost:8787 — Frontend: http://localhost:5173 (proxied su `/api/*`).

## Comandi utili

| Comando | Descrizione |
|---|---|
| `npm run dev` | Server + Vite in parallelo |
| `npm run build` | Build production (client + server) |
| `npm start` | Avvia il bundle di produzione |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | Test runner nativo Node |
| `npm run db:generate` | Genera SQL migrations da `schema.ts` |
| `npm run db:migrate` | Applica migrations sul DB target |
| `npm run db:studio` | UI Drizzle Studio |
| `npm run import:legacy` | Importa JSON export di CalcoliVari |

## Deploy

```bash
fly launch --no-deploy
fly secrets set SESSION_SECRET=...
fly secrets set DATABASE_URL=libsql://...
fly secrets set DATABASE_AUTH_TOKEN=...
fly deploy
```

## Documenti

- [`docs/architecture.md`](docs/architecture.md) — stack, runtime, flussi dati
- [`docs/data-model.md`](docs/data-model.md) — schema DB + scelte di design
- [`docs/migration-plan.md`](docs/migration-plan.md) — roadmap da CalcoliVari
- [`CLAUDE.md`](CLAUDE.md) — guida per Claude Code (contesto progetto)
