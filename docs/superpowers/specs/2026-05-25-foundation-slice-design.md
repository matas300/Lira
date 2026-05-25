# Foundation Slice — Design

**Data:** 2026-05-25
**Stato:** approvato (in attesa di review utente sul file scritto)
**Slice:** copre Fase 1 (Foundation) + Fase 2 (Auth) di `docs/migration-plan.md`.

## Obiettivo

Costruire la base end-to-end deployabile di Lira: schema DB completo, server Hono con auth a sessioni su DB, CLI per creare utenti/profili, frontend shell con dark theme portato da CalcoliVari. **Zero feature fiscali** in questo slice — quelle arrivano negli slice successivi (Fatture, Scadenziario, Dichiarazione, ecc.).

Non è un progetto greenfield: è il primo strato della **trasformazione fullstack** di CalcoliVari. Non aggiungere feature, non riprogettare UX (vedi `[[feedback-no-redesign]]`).

## Contesto e vincoli

- **Utenti totali finali**: 3 (utente proprietario, Peru, 1 account demo). App **strettamente privata**, non SaaS. → registrazione disabilitata, password reset via CLI, zero email service, zero attack surface inutile.
- **Stack già deciso** in `docs/architecture.md`: Vite + TS + Hono + Drizzle (libSQL) + Turso + Argon2id + cookie sessions + Fly.io. Niente da rimettere in discussione.
- **Multi-profilo**: un user può possedere N profiles (es. utente proprietario gestisce sia "mattia" che "peru" sotto lo stesso account). Lo switch profilo è gestito a livello di session row (`active_profile_id`).
- **Trusted CLI**: tutti gli script `npm run create-user`, `reset-password`, ecc. partono dall'assunzione che chi li lancia è admin (= utente proprietario sulla sua macchina). Niente auth flow per CLI.

## Scope

### Dentro

1. **Schema DB completo** di `docs/data-model.md` in **una singola migration baseline** (`drizzle/0000_baseline.sql`).
2. **Hono server** con health check + auth endpoints + middleware sessione + error handler.
3. **Auth completa**:
   - Argon2id (memoryCost 64MB, default sicuro).
   - Cookie HTTP-only `lira_session` (SameSite=Lax, Secure in prod).
   - Sessions in tabella `sessions` con TTL 30gg rolling (refresh `last_used_at` su ogni richiesta autenticata).
   - Multi-profilo: creazione + switch + `active_profile_id` in session.
4. **CLI scripts**:
   - `npm run create-user -- <email> <password>` → crea user **e** profilo default (`slug=default`, `display_name=email-localpart`) in una singola transazione. Output: `User created: <id> | Default profile: <id>`.
   - `npm run reset-password -- <email> <newPassword>` → reset password + invalida tutte le sessioni dell'utente.
   - `npm run create-profile -- <email> <slug> <displayName>` → aggiunge profilo a user esistente.
5. **Frontend shell**:
   - `tokens.css` con palette Espresso & Mint portata letteralmente dal `style.css` di CalcoliVari.
   - Layout app: header con nome utente + selettore profilo attivo; bottom nav mobile con tab placeholder (Fatture/Scadenze/Dichiarazione) **disabilitate** in questo slice; container principale.
   - Router pathname-based (~30 righe, niente framework): lookup `pathname` → `import()` dinamico della page → `mount(container)` → cleanup su cambio.
   - Pagine implementate: `login`, `dashboard` (saluto + lista profili), `profiles` (selezione + creazione nuovo profilo).
6. **Setup Turso** documentato nel README con comandi pronti.
7. **Test**:
   - Integration test su flow auth (register-via-CLI → login → me → switch profilo → logout → re-login invalido) contro SQLite in-memory.
   - Unit test su `password.ts` e `session.ts`.

### Fuori (slice successivi)

- Modulo Fatture (CRUD, wizard, XML FatturaPA, PDF, import legacy).
- Modulo Scadenziario + tax-engine port da `tax-engine.js`.
- Modulo Clienti (CRUD + autofill P.IVA).
- Modulo Dichiarazione (LM/RR/RS/RX/RW).
- Modulo Calendario, Budget, Spese.
- Importer `scripts/import-from-calcolivari.ts`.
- **Deploy Fly produzione** (lo slice "post-Foundation" sarà: smoke test Dockerfile + fly.toml + primo deploy; vedi task #6 nella TaskList di sessione).
- Test E2E Playwright.
- Backup R2, audit log, rate limiting, CSP, security headers.

## Architettura

### Directory layout

```
src/
├── server/
│   ├── index.ts                   # Hono app + listen + mount routes + error handler
│   ├── db/
│   │   ├── client.ts              # createClient libSQL (file:// in dev, libsql:// in prod)
│   │   ├── schema.ts              # Drizzle schema completo (tutte le tabelle)
│   │   └── migrate.ts             # runner: applica drizzle/*.sql
│   ├── middleware/
│   │   ├── auth.ts                # requireSession: lookup session, refresh, c.set('userId'/'profileId')
│   │   └── error.ts               # cattura Hono errors → JSON {error:{code,message,details?}}
│   ├── routes/
│   │   ├── health.ts              # GET /api/health → {ok:true, version}
│   │   ├── auth.ts                # POST /login, POST /logout, GET /me
│   │   └── profiles.ts            # GET /, POST /, POST /:slug/activate
│   └── lib/
│       ├── password.ts            # hash(plain) → string ; verify(plain, hash) → bool
│       └── session.ts             # create(userId, profileId), refresh(id), delete(id), deleteAllForUser(userId)
├── client/
│   ├── index.html
│   ├── main.ts                    # router pathname-based + bootstrap
│   ├── lib/
│   │   ├── api.ts                 # fetch wrapper credentials:'include' + Zod response parsing
│   │   └── auth.ts                # getMe(), login(), logout(), switchProfile(slug)
│   ├── pages/
│   │   ├── login.ts               # mount(container): () => void
│   │   ├── dashboard.ts
│   │   └── profiles.ts
│   ├── components/
│   │   ├── header.ts              # nome utente + profilo attivo + dropdown switch
│   │   └── bottom-nav.ts          # tab Fatture/Scadenze/Dichiarazione (disabled in foundation)
│   └── styles/
│       ├── tokens.css             # palette + spacing + radii + typography (port CalcoliVari)
│       ├── reset.css
│       ├── components.css         # .btn, .input, .card, .badge
│       └── index.css              # entrypoint
└── shared/
    ├── schemas.ts                 # Zod schemas: LoginInput, ProfileCreateInput, MeResponse, ...
    └── types.ts                   # type aliases derivati

scripts/
├── create-user.ts                 # crea user + profilo default in transazione
├── reset-password.ts              # reset + invalida tutte le sessioni
└── create-profile.ts              # aggiunge profilo a user esistente
```

### API endpoints

| Metodo | Path                         | Auth | Body / Query                   | Risposta                                  |
|--------|------------------------------|------|--------------------------------|-------------------------------------------|
| GET    | `/api/health`                | no   | —                              | `{ ok: true, version }`                   |
| POST   | `/api/auth/login`            | no   | `{ email, password }`          | `{ user, profiles, activeProfile }`, Set-Cookie |
| POST   | `/api/auth/logout`           | sì   | —                              | `{ ok: true }`, clear cookie              |
| GET    | `/api/auth/me`               | sì   | —                              | `{ user, profiles, activeProfile }`       |
| GET    | `/api/profiles`              | sì   | —                              | `{ profiles: [...] }`                     |
| POST   | `/api/profiles`              | sì   | `{ slug, displayName }`        | `{ profile }`                             |
| POST   | `/api/profiles/:slug/activate` | sì | —                              | `{ activeProfile }`                       |

Tutti i body validati con Zod via `@hono/zod-validator`. Errori → status code HTTP + `{ error: { code, message, details? } }`.

### Auth flow (login)

1. Client `POST /api/auth/login { email, password }`.
2. Server cerca user per email (case-insensitive), verifica hash Argon2id.
   - Se non esiste o hash non matcha → `401 { error: { code: 'INVALID_CREDENTIALS' } }`. (Tempo di risposta costante: sempre eseguire un `verify` dummy se user non esiste, per evitare timing attack.)
3. Server fetch profili dell'utente. Sceglie `activeProfileId` = primo profilo per `created_at` (in genere il "default" creato dal CLI). **Invariant:** ogni user ha almeno 1 profilo (garantito da `create-user`). Se per qualche motivo non ce ne sono → `500 { error: { code: 'NO_PROFILE' } }` — è uno stato corrotto, non un flusso utente.
4. Server `INSERT INTO sessions (id, user_id, active_profile_id, expires_at, created_at, last_used_at)` con `id = randomUUID()`, `expires_at = now + 30gg`.
5. Server `Set-Cookie: lira_session=<id>; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=2592000` (Secure in prod).
6. Risposta: `{ user, profiles, activeProfile }`.

### Middleware `requireSession`

1. Legge cookie `lira_session`.
2. `SELECT * FROM sessions WHERE id = ?`. Se assente → `401`.
3. Se `expires_at < now` → DELETE + `401`.
4. Aggiorna `last_used_at = now`, `expires_at = now + 30gg` (rolling refresh).
5. `c.set('userId', session.user_id)` + `c.set('activeProfileId', session.active_profile_id)`.

### Switch profilo

`POST /api/profiles/:slug/activate`:
1. `requireSession` ha già `userId`.
2. Verifica che `profiles` row con `(user_id=userId, slug=:slug)` esista. Se no → `404`.
3. `UPDATE sessions SET active_profile_id = ? WHERE id = ?`.
4. Risposta `{ activeProfile }`.

### Frontend router (`main.ts`)

```ts
const routes: Record<string, () => Promise<{ mount: (c: HTMLElement) => () => void }>> = {
  '/login': () => import('./pages/login'),
  '/': () => import('./pages/dashboard'),
  '/profiles': () => import('./pages/profiles'),
};

// flusso: getMe() → se !user → redirect /login ; else mount pagina richiesta in container.
```

Non un router framework. Cleanup tramite la callback ritornata da `mount`. Navigazione: link `<a data-route="/profiles">` intercettati globalmente + `history.pushState`.

### Schema DB — note sulla baseline migration

- **Tutte** le tabelle di `docs/data-model.md` create in `0000_baseline.sql` (incluse quelle inutilizzate negli slice successivi: `fatture`, `pagamenti`, `clienti`, ecc.).
- **Razionale**: il data-model è stato pensato a fondo; tabelle vuote non costano nulla a SQLite; gli slice successivi non devono pensare a "create table", solo a "CRUD su tabella esistente". Se durante l'implementazione di un modulo emergerà la necessità di alterare lo schema → vera migration versionata.
- **Indici**: tutti quelli elencati in `data-model.md` sezione "Indici previsti".

## Test plan

| Tipo | Cosa | Dove |
|------|------|------|
| Unit | `password.hash()` + `verify()` round-trip, verify con hash sbagliato → false, verify con plain sbagliato → false | `src/server/lib/password.test.ts` |
| Unit | `session.create` ritorna UUID + scrive row; `refresh` aggiorna `last_used_at`; `delete` rimuove; `deleteAllForUser` rimuove tutte | `src/server/lib/session.test.ts` |
| Integration | Setup: SQLite in-memory, applica migrations, crea user via funzione `createUser()` (la stessa che usa il CLI). | `src/server/auth.integration.test.ts` |
| Integration | Login con credenziali corrette → 200 + cookie + body. | id. |
| Integration | Login con password sbagliata → 401. | id. |
| Integration | Login con email inesistente → 401 con stesso timing (entro tolleranza) come password sbagliata. | id. |
| Integration | `GET /api/auth/me` senza cookie → 401. | id. |
| Integration | `GET /api/auth/me` con cookie valido → 200 + user payload. | id. |
| Integration | Switch profilo con `slug` proprio → 200 + session aggiornata. | id. |
| Integration | Switch profilo con `slug` di un altro user → 404 (NB: non 403, evita user-enumeration). | id. |
| Integration | Reset password (via funzione `resetPassword()`) → vecchio cookie ora 401 + nuova password funziona. | id. |
| Integration | Sessione con `expires_at` nel passato → 401 + cleanup riga. | id. |

**Niente test UI** in questo slice. Quelli arrivano con E2E in Hardening.

Approccio TDD: **non strict** per questo slice. Lo era se fosse codice con logica fiscale, ma qui è "plumbing classico" — meglio scrivere il prod e dietro l'integration test che gira contro DB reale. **TDD strict invece sarà obbligatorio** quando porteremo `tax-engine.js` (slice Scadenziario).

## Setup esterno (Turso)

README sezione "Primo setup":

```bash
# 1. Turso CLI (una tantum)
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login

# 2. Crea DB produzione
turso db create lira-prod --location fra
turso db tokens create lira-prod --expiration none

# 3. Configura .env
cp .env.example .env
# Per dev locale, lascia: DATABASE_URL=file:./lira.db (default, no Turso necessario)
# Per dev contro prod-like, metti: DATABASE_URL=libsql://lira-prod-<org>.turso.io + DATABASE_AUTH_TOKEN=...

# 4. Migrazioni + primo utente
npm install
npm run db:migrate
npm run create-user -- matas300@gmail.com 'PasswordSicuraQui'
# Output: User created + default profile created

# 5. Dev
npm run dev
# → http://localhost:5173, login con le credenziali sopra
```

`.env.example`:
```
DATABASE_URL=file:./lira.db
# DATABASE_AUTH_TOKEN=          # solo per libsql:// remoto
SESSION_SECRET=change-me        # placeholder, riservato per usi futuri (es. firma cookie); non strettamente necessario per session-id-as-cookie-value
NODE_ENV=development
PORT=3000
```

## Definition of Done

- [ ] `npm install && npm run db:migrate && npm run create-user -- ... && npm run dev` parte clean da clone.
- [ ] `http://localhost:5173` → pagina login renderizzata con dark theme Espresso & Mint.
- [ ] Login con credenziali create da CLI → redirect a dashboard, header mostra nome utente + profilo attivo.
- [ ] Switch profilo dal dropdown header → riga session aggiornata in DB, `getMe()` riflette nuovo profilo.
- [ ] Logout → torna a login, cookie cancellato lato browser, riga session cancellata in DB.
- [ ] Tentativo accesso `/api/profiles` senza cookie → 401 JSON `{error:{code:'UNAUTHENTICATED'}}`.
- [ ] CLI `reset-password matas300@gmail.com 'NuovaPwd'` → vecchie sessioni invalidate, login con vecchia password fallisce, login con nuova password funziona.
- [ ] `npm test` verde (tutti integration + unit).
- [ ] `npm run typecheck` zero errori.
- [ ] README aggiornato con istruzioni Turso + comandi CLI.

## Decisioni rinviate (post-Foundation)

- **Deploy Fly produzione**: Dockerfile e `fly.toml` sono già nello scaffold ma non li verifichiamo ora. Smoke-test + primo deploy nello slice successivo, prima della prima feature fiscale. (Task #6 nella TaskList di sessione.)
- **Audit log** su modifiche a `users`/`profiles`: utile ma non in Foundation.
- **Rate limiting** su `/api/auth/login`: utile, ma 3 utenti chiusi e zero endpoint pubblici → rinviato a Hardening.
- **Multi-device session listing/revoke UI** ("hai 2 sessioni attive, revoca questa"): non in Foundation. Tabella `sessions` lo permette quando servirà.
- **CSP + security headers**: in Hardening.

## Cose che NON faremo (mai, o quasi mai)

- Endpoint pubblico `POST /api/auth/register`. Utenti solo via CLI.
- Password reset via email. Solo CLI.
- 2FA / TOTP. Overkill per 3 utenti su rete privata.
- JWT. Sessions su DB più semplici da revocare.
- Refresh token. Cookie sessions con rolling TTL bastano.
- localStorage per dati di dominio. Solo UI state (es. ultimo path visitato, se proprio serve).
