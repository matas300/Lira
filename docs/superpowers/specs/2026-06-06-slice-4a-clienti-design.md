# Slice 4A — Clienti (Design / Spec)

- **Data:** 2026-06-06
- **Stato:** approvato (brainstorm), in attesa review spec
- **Slice:** 4A (prima sotto-slice di Slice 4 — Fatture, decomposta)
- **Predecessore:** Slice 3 (importer) su `main`
- **Workflow:** brainstorm → **spec (questo doc)** → writing-plans → subagent-driven execute

---

## 1. Obiettivo & scope

Modulo **Clienti** come **vertical slice completo**: backend (CRUD `/api/clienti` + validazione server-side + autofill da P.IVA) **e** frontend (pagina Clienti con lista/ricerca/modal). È la **prima vera slice frontend** di Lira → stabilisce il pattern UI e un **componente modal riusabile** (wizard Fatture 4C, NC 4E).

**Prerequisito hard delle Fatture**: il wizard fattura seleziona un cliente, ne congela uno snapshot e usa il cliente di default.

**Decomposizione Slice 4 (contesto):** 4A Clienti · 4B Fattura core (modello+numerazione+state machine+storico) · 4C Wizard+PDF · 4D XML FatturaPA (+fix C2) · 4E NC TD04 · 4F Import XML. Questo doc copre **solo 4A**.

**Non-goals (4A):** qualsiasi cosa Fatture; check-digit CF completo (qui solo formato — arriverà col modulo Dichiarazione come validatore `@shared`); Firestore; OCR.

---

## 2. Architettura & file layout

```
src/shared/
  validators.ts (+ .test.ts)        # check-digit P.IVA, formato CF, SDI/IPA per tipo, PEC (puro, riusabile)
  schemas.ts  (estendo)             # TipoClienteEnum, ClienteCreateInput/UpdateInput, ClientePublic, PivaLookupResult
  types.ts    (estendo)             # tipi derivati (Cliente, PivaLookupData)
src/server/
  lib/piva-lookup.ts (+ .test.ts)   # lookupPartitaIva(piva,{apiKey,fetchImpl}) → risultato normalizzato
  routes/clienti.ts (+ .test.ts)    # CRUD + GET /lookup/:piva + single-default
  index.ts                          # mount app.route('/api/clienti', clientiRoute)
src/client/
  lib/api.ts        (estendo)       # aggiungo patch + del
  lib/clienti-api.ts                # client tipizzato (list/create/update/remove/setDefault/lookupPiva)
  components/modal.ts               # modal vanilla riusabile (open/close/ESC/backdrop/focus-trap)
  pages/clienti.ts                  # tab: lista + ricerca + modal form + autofill
  components/bottom-nav.ts (estendo)# voce "Clienti"
  main.ts                  (estendo)# route '/clienti'
```

Le parti pure (`validators`, `piva-lookup` con `fetch` iniettato) non toccano DOM/DB e sono testabili in isolamento. La route segue il pattern di `routes/pagamenti.ts` (Hono, `requireSession`, scoped `activeProfileId`). La pagina segue `pages/profiles.ts` (`mount(container) => unmount`, `innerHTML` + `addEventListener`, niente `window.*`).

---

## 3. Modello dati (`clienti` — tabella già esistente)

Nessuna modifica schema in 4A. Colonne rilevanti (`src/server/db/schema.ts`): `id` (text PK), `profile_id` (FK), `nome`, `tipo_cliente` (default `PG`), `partita_iva?`, `codice_fiscale?`, `codice_sdi` (default `0000000`), `pec?`, `indirizzo?`, `cap?`, `citta?`, `provincia?`, `nazione` (default `IT`), `descrizione_standard?`, `is_default` (0/1), `note?`, timestamps.

Indici UNIQUE: `clienti_profile_piva_idx` su `(profile_id, partita_iva)`, `clienti_profile_cf_idx` su `(profile_id, codice_fiscale)`. (SQLite tratta NULL multipli come distinti → più clienti senza P.IVA/CF sono ammessi.)

**Default**: modellato dalla colonna `is_default` (più pulito del `clienteDefaultId` separato di CalcoliVari). Invariante: **al più un cliente con `is_default=1` per profilo**, garantita in transazione lato route.

---

## 4. Validazione (`shared/validators.ts`, funzioni pure)

```ts
isValidPartitaIvaIT(piva: string): boolean
isValidCodiceFiscaleFormat(cf: string): boolean
isValidCodiceSdi(sdi: string, tipo: TipoCliente): boolean
isValidPec(pec: string): boolean
```

**P.IVA IT — check-digit (algoritmo ufficiale, Luhn italiano):**
- Deve essere `^\d{11}$`.
- Sui primi 10 digit: posizioni dispari (1ª,3ª,…,9ª, 1-indexed) sommate as-is; posizioni pari (2ª,…,10ª) raddoppiate, se `>9` sottrai 9, poi sommate.
- `check = (10 - (somma % 10)) % 10`. Valida se `check === digit[11]`.

**CF:** solo formato `^[A-Z0-9]{16}$` (uppercase). Il check-digit completo (tabelle pari/dispari) arriverà col modulo Dichiarazione come validatore condiviso — qui **fuori scope**.

**SDI/IPA:** se `tipo === 'PA'` → `^[A-Z0-9]{6}$` (codice IPA); altrimenti → `^[A-Z0-9]{7}$` (default `0000000` per privati/PG/estero).

**PEC:** email base `^[^@\s]+@[^@\s]+\.[^@\s]+$` (nullable/opzionale).

---

## 5. Zod schemas (`shared/schemas.ts`)

```
TipoClienteEnum = z.enum(['PF','PG','PA','Estero'])

ClienteCreateInput = z.object({
  nome: z.string().min(1).max(200),
  tipoCliente: TipoClienteEnum.default('PG'),
  partitaIva: z.string().optional().nullable(),
  codiceFiscale: z.string().optional().nullable(),
  codiceSdi: z.string().default('0000000'),
  pec: z.string().optional().nullable(),
  indirizzo/cap/citta/provincia: z.string().optional().nullable(),
  nazione: z.string().length(2).default('IT'),
  descrizioneStandard: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
})
  .refine(piva valida se presente, → isValidPartitaIvaIT)
  .refine(cf formato se presente, → isValidCodiceFiscaleFormat)
  .refine(codiceSdi valido per tipo, → isValidCodiceSdi)
  .refine(pec valida se presente)
  .refine(cliente IT (nazione 'IT') ⇒ partitaIva || codiceFiscale)   // FatturaPA §1.4.1.2
  .refine(tipo 'PA' ⇒ codiceSdi 6 char IPA)

ClienteUpdateInput = ClienteCreateInput.partial()
ClientePublic = { id, profileId, nome, tipoCliente, partitaIva, codiceFiscale, codiceSdi, pec, indirizzo, cap, citta, provincia, nazione, descrizioneStandard, isDefault(bool), note, createdAt, updatedAt }
PivaLookupResult = { ok: boolean, data?: PivaLookupData, code?: string }
```

> `nazione` e `provincia` sono normalizzate **uppercase** (via `.transform`), `codiceSdi` default `0000000` — come `normalizeCliente` di CalcoliVari. Il refine "cliente IT" confronta `nazione === 'IT'` dopo la normalizzazione.

Errori di validazione → `400` con `{ error: { code:'VALIDATION', message, details } }` (envelope esistente).

---

## 6. Route `/api/clienti` (`routes/clienti.ts`)

Pattern `pagamenti.ts`: `requireSession`, tutto scoped a `c.get('activeProfileId')`, `zValidator('json', …)`.

| Metodo | Path | Comportamento |
|---|---|---|
| GET | `/` | lista clienti del profilo (ordinati per nome). Ricerca lato client. |
| POST | `/` | crea; `id = randomUUID()`. UNIQUE (profile,piva)/(profile,cf) violata → **`409 CLIENTE_DUPLICATE`**. Se `isDefault` → vedi single-default. |
| PATCH | `/:id` | update parziale (404 se non del profilo); re-valida; gestisce `isDefault`. |
| DELETE | `/:id` | hard delete (404 se non del profilo). |
| GET | `/lookup/:piva` | autofill (vedi §7). |

**Single-default (transazione):** quando un cliente è creato/aggiornato con `isDefault=true`, in `db.transaction`: `UPDATE clienti SET is_default=0 WHERE profile_id=? AND id<>?` poi set `is_default=1` sul target. Garantisce ≤1 default per profilo.

**toPublic**: `is_default` integer → `isDefault` boolean nel JSON (come `pagamenti.ts` fa per linkedKeys).

---

## 7. Autofill da P.IVA (`lib/piva-lookup.ts` + `GET /lookup/:piva`)

```ts
interface PivaLookupData { nome?, codiceFiscale?, indirizzo?, cap?, citta?, provincia?, pec?, codiceSdi? }
interface PivaLookupResult { ok: boolean; data?: PivaLookupData; code?: 'INVALID_PIVA'|'NO_KEY'|'NOT_FOUND'|'NETWORK' }
async function lookupPartitaIva(piva: string, opts: { apiKey?: string; fetchImpl?: typeof fetch }): Promise<PivaLookupResult>
```

- Valida `piva` (`^\d{11}$`) → altrimenti `INVALID_PIVA`. Se `!apiKey` → `NO_KEY`.
- `GET https://company.openapi.com/IT-start/{piva}`, header `Authorization: Bearer {apiKey}`.
- **Normalizzazione** (porta `normalizeResponse`/`pickAddress` da `CalcoliVari/clienti-autofill.js`): gestisce risposta `data` array o oggetto, alias di campo multipli → `PivaLookupData`.
- `404` → `NOT_FOUND`; errore rete/parse → `NETWORK`.
- `fetchImpl` iniettabile (default `globalThis.fetch`) → test senza rete.

**Route `GET /lookup/:piva`**: legge `process.env.OPENAPI_COMPANY_KEY`, chiama `lookupPartitaIva(piva, {apiKey})`. Mapping HTTP: `ok`→`200 {data}`; `INVALID_PIVA`→`400`; `NO_KEY`→`503 AUTOFILL_UNAVAILABLE`; `NOT_FOUND`→`404`; `NETWORK`→`502`.

**Degrado con grazia:** senza key l'endpoint risponde `503`; il client mostra "autofill non disponibile" ma l'inserimento manuale funziona. *La key reale (`OPENAPI_COMPANY_KEY`) va fornita dall'utente per il test live; i test unit usano `fetchImpl` mockato.*

---

## 8. Frontend

### 8.1 `components/modal.ts` (riusabile, ~50 righe)
```ts
openModal(opts: { title: string; bodyHtml: string; onMount?: (root: HTMLElement, close: () => void) => void }): { close: () => void; root: HTMLElement }
```
Crea backdrop + dialog (token dark theme), ESC e click-backdrop chiudono, focus-trap basilare, ritorna handle. Nessun framework. Riusato da 4C (wizard) e 4E (NC).

### 8.2 `lib/api.ts` (estendo)
Aggiungo `patch<T>(path, body)` e `del<T>(path)` ai metodi esistenti `get`/`post`.

### 8.3 `lib/clienti-api.ts`
Client tipizzato: `listClienti()`, `createCliente(input)`, `updateCliente(id, input)`, `removeCliente(id)`, `setDefault(id)`, `lookupPiva(piva)`. Mappa su `api.*` e tipi `@shared`.

### 8.4 `pages/clienti.ts` (pattern `profiles.ts`)
- `mount(container) => unmount`. Render: `renderHeader` + main con barra (ricerca + "Nuovo") + lista clienti (★ default / nome / P.IVA / città; click riga → modal) + `renderBottomNav`.
- **Ricerca**: filtro lato client su nome/P.IVA/città.
- **Modal cliente** (via `openModal`): form con tutti i campi; label e maxlength SDI/IPA cambiano con `tipoCliente`; **bottone Autofill** → `lookupPiva`, **merge solo nei campi vuoti** (non sovrascrive l'input dell'utente); Salva (POST nuovo / PATCH esistente); Elimina (con conferma); ★ toggle default.
- Errori `ApiError` mostrati inline nel form; autofill non-bloccante (messaggio se `503`/`404`).
- **XSS**: escape di tutti i valori utente nei template (`escapeHtml` helper).

### 8.5 Navigazione
`bottom-nav.ts`: voce "Clienti" (`data-route="/clienti"`). `main.ts`: `'/clienti': () => import('./pages/clienti')`.

---

## 9. Error handling

- Server: Zod → `400 VALIDATION` + `details`; unique → `409 CLIENTE_DUPLICATE`; not-found → `404 CLIENTE_NOT_FOUND`; lookup → `400/404/502/503` (§7). Tutto via `HttpError` + `errorHandler` esistenti.
- Client: `ApiError.message` inline nel form; autofill degrada senza bloccare il salvataggio manuale.

---

## 10. Decisioni-giudizio (confermate dall'utente 2026-06-06)

1. **Autofill merge** = solo campi vuoti (non sovrascrive l'input). ✅
2. **Single-default** in transazione (≤1 default per profilo). ✅
3. **Ricerca lato client** (`GET /` ritorna tutti i clienti del profilo). ✅
4. **`OPENAPI_COMPANY_KEY` da env**, degrado a manuale se assente. ✅
5. **Validazione**: check-digit P.IVA + CF formato + SDI/IPA per tipo + PEC. ✅
6. **Autofill incluso in 4A** (server-side). ✅

---

## 11. Testing

- `shared/validators.test.ts`: P.IVA check-digit (P.IVA reali valide + invalide per check-digit + lunghezza errata), CF formato, SDI/IPA per tipo (PA 6 / privato 7), PEC.
- `lib/piva-lookup.test.ts`: `fetchImpl` mockato → `ok` (con normalizzazione alias array/oggetto), `404`→`NOT_FOUND`, throw→`NETWORK`, `apiKey` assente→`NO_KEY`, piva invalida→`INVALID_PIVA`.
- `routes/clienti.test.ts` (pattern `makeApp()`): CRUD round-trip; scoping al profilo (cliente di altro profilo → 404); `409` su P.IVA duplicata; single-default (creo 2 default → solo l'ultimo resta); `GET /lookup` con `fetchImpl`/env mockato; validazione → 400.
- **Frontend**: smoke Playwright (estende `scripts/smoke-playwright.mjs`): login → apri /clienti → crea cliente → compare in lista → set default. Il resto della UI è coperto indirettamente dai test API.
- Suite verde in aggiunta ai 194 esistenti; nessuna regressione.

---

## 12. Rischi & mitigazioni

| Rischio | Mitigazione |
|---|---|
| Dipendenza esterna openapi (key/quota/rete) | `fetchImpl` iniettato nei test; degrado `503`→manuale; key in env, mai nel client |
| Check-digit P.IVA sbagliato | test con P.IVA reali note valide/invalide |
| Modal riusabile mal progettato (debito UI) | API minima `openModal`; validato subito dall'uso in Clienti, poi 4C/4E |
| Regressione su single-default | test esplicito multi-default |
| `partita_iva` NULL e unique index | verificato: SQLite ammette NULL multipli |

---

## 13. Definition of Done

- [ ] `GET/POST/PATCH/DELETE /api/clienti` funzionanti, scoped al profilo, con validazione server-side (check-digit P.IVA).
- [ ] `409` su P.IVA/CF duplicata; single-default garantito in transazione.
- [ ] `GET /api/clienti/lookup/:piva` con env key + degrado `503`.
- [ ] Pagina `/clienti`: lista+ricerca+modal CRUD+autofill+default, su componente `modal.ts` riusabile.
- [ ] `api.ts` esteso con patch/del; voce nav + route.
- [ ] Suite test verde (validators + piva-lookup + route + smoke) oltre ai 194 esistenti.
- [ ] `docs/migration-plan.md` Fase 4 (Clienti) spuntata; `data-model.md` invariato.
