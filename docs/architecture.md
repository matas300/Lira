# Architecture

## Runtime

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  Browser (Vite SPA)     │         │  Fly.io VM (512MB)      │
│                         │         │                         │
│  Vite client (TS)       │  HTTPS  │  Hono server (Node 22)  │
│  - vanilla DOM          ├────────►│  - REST /api/*          │
│  - Zod-validated forms  │ cookie  │  - Drizzle ORM          │
│  - session cookie       │ session │  - Argon2 password hash │
│                         │         │  - cookie session       │
└─────────────────────────┘         └────────────┬────────────┘
                                                  │
                                                  │ libSQL (HTTP)
                                                  ▼
                                    ┌─────────────────────────┐
                                    │  Turso (libSQL/SQLite)  │
                                    │  - schema gestito       │
                                    │    via Drizzle          │
                                    │  - free tier ~9GB       │
                                    │  - region: fra (FRA)    │
                                    └─────────────────────────┘
```

## Flusso di richiesta autenticata

1. Browser invia `Cookie: lira_session=<uuid>` su `/api/fatture`.
2. Middleware `requireSession` (`src/server/middleware/auth.ts`) cerca la session in tabella `sessions`. Se assente o scaduta → `401`.
3. Sessione valida → `c.set('userId', ...)`, `c.set('profileId', ...)` (profilo attivo del cookie).
4. Handler eseguisce la query Drizzle, valida output con Zod, ritorna JSON.

## Auth

- **Registrazione**: `POST /api/auth/register { email, password }` → Argon2id hash → `users` row → session creata → cookie settato.
- **Login**: `POST /api/auth/login { email, password }` → fetch user → verify hash → nuova session.
- **Logout**: `POST /api/auth/logout` → delete session row → clear cookie.
- **Multi-profilo**: un `user` può possedere N `profiles` (es. Mattia e Peru gestiti dallo stesso utente). Switch profilo via `POST /api/profiles/{slug}/activate` → aggiorna `active_profile_id` sulla session.

## Frontend

- Vite serve `index.html` con `main.ts` come entry.
- `main.ts` monta un router minimale basato su `URL pathname` → carica dinamicamente moduli `pages/*.ts`.
- Ogni page è una funzione `mount(container: HTMLElement): () => void` (ritorna `unmount` per cleanup).
- Nessun virtual DOM. Update via direct DOM manipulation + delegazione eventi su container.
- Stato: nessun global store. Ogni page tiene state locale; condivisione via API server (cloud authoritative).

## Stile UI

- Token CSS centralizzati in `src/client/styles/tokens.css` (palette Espresso & Mint + scala spacing/radius/typography).
- Componenti riutilizzabili: vanilla CSS classes (no shadow DOM). Es. `.btn`, `.btn-primary`, `.input`, `.card`, `.badge`.
- Mobile: bottom nav + safe-area-inset, come CalcoliVari.

## Deploy

1. `fly launch --no-deploy` (prima volta).
2. `fly secrets set SESSION_SECRET=$(openssl rand -hex 32)`.
3. `fly secrets set DATABASE_URL=libsql://<your-db>.turso.io DATABASE_AUTH_TOKEN=...`.
4. `fly deploy` → build container localmente → push a Fly registry → swap atomico.
5. Migrations: il container all'avvio esegue `npm run db:migrate` (vedi `Dockerfile`).

## Backup

- Turso: backup automatici sul piano gratuito (point-in-time).
- Backup applicativo extra: cron Fly (TBD) che esporta `SELECT * FROM` come JSON gz su Cloudflare R2 (free tier 10GB).

## Performance budget

- Hono server idle: ~30MB RAM.
- Node 22 runtime: ~60MB.
- Margine VM 512MB: abbondante per 3 utenti.
- Cold start Fly: ~2-3s (`auto_start_machines = true`).
- Tempo risposta target: P99 < 200ms per query semplici (libSQL Turso ha P50 ~10ms).
