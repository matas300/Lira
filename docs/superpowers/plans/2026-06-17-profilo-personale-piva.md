# Profilo personale + Profilo P.IVA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere editabili da UI i dati anagrafici e di attività del profilo attivo (oggi importati ma non modificabili), tramite due pagine — `/profilo-personale` e `/profilo-piva` — che condividono backend e logica pura.

**Architecture:** Nuovi endpoint `GET/PATCH /api/profiles/active` sul profilo in sessione (PATCH = read-modify-write non distruttivo che preserva `regime_default` e chiavi extra). Logica pura condivisa in `lib/profile-form.ts` (defaults, mapping stato↔body, validatori di formato). Due pagine col pattern di `impostazioni.ts` (render puri testabili + `mount` con fetch/save). Validazione permissiva: salva sempre, segnala solo i formati errati.

**Tech Stack:** TypeScript strict (noUncheckedIndexedAccess), Hono + Drizzle (libSQL), Zod, Vite vanilla DOM, Node `--test`.

---

## File Structure

- Modify: `src/shared/schemas.ts` — `ProfileAnagrafica`, `ProfileAttivita`, `ProfilePatchInput`.
- Test: `src/shared/schemas.test.ts` — append test per i nuovi schemi.
- Modify: `src/server/routes/profiles.ts` — `GET /active` + `PATCH /active` + helper parse/merge.
- Modify: `src/server/routes/profiles.test.ts` — append test GET/PATCH.
- Create: `src/client/lib/profile-form.ts` — logica pura (defaults, fromResponse, toBody, copyResidenzaToDomicilio, validatori).
- Test: `src/client/lib/profile-form.test.ts`.
- Create: `src/client/pages/profilo-personale.ts` — render puri + mount (anagrafica + displayName).
- Test: `src/client/pages/profilo-personale.test.ts`.
- Create: `src/client/pages/profilo-piva.ts` — render puri + mount (attivita + giorniIncasso).
- Test: `src/client/pages/profilo-piva.test.ts`.
- Modify: `src/client/main.ts` — route `/profilo-personale` e `/profilo-piva` → nuove pagine.
- Modify: `src/client/styles/index.css` — poche classi `pf-*` (riusa il grosso da `.ys-*`).

---

## Task 1: Schemi condivisi (anagrafica / attività / patch)

**Files:**
- Modify: `src/shared/schemas.ts`
- Test: `src/shared/schemas.test.ts`

- [ ] **Step 1: Scrivere i test (append in coda al file)**

In `src/shared/schemas.test.ts` aggiungere:

```ts
import { ProfileAnagrafica, ProfileAttivita, ProfilePatchInput } from './schemas';

test('ProfileAnagrafica — tutto opzionale, vuoto valido', () => {
  assert.deepEqual(ProfileAnagrafica.parse({}), {});
  const r = ProfileAnagrafica.parse({
    nome: 'Mario', cognome: 'Rossi', cf: 'rssmra80a01h501u',
    residenza: { indirizzo: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'rm' },
  });
  assert.equal(r.nome, 'Mario');
  assert.equal(r.cf, 'RSSMRA80A01H501U');      // CF normalizzato uppercase
  assert.equal(r.residenza?.provincia, 'RM');  // provincia uppercase
});

test('ProfileAttivita — partita_iva e ateco opzionali, regime_default NON nello schema', () => {
  const r = ProfileAttivita.parse({ partita_iva: '00743110157', codice_ateco: '62.01.00' });
  assert.equal(r.partita_iva, '00743110157');
  assert.equal('regime_default' in r, false);  // preservato lato server, non in input
});

test('ProfilePatchInput — campi tutti opzionali (patch parziale)', () => {
  assert.deepEqual(ProfilePatchInput.parse({}), {});
  const r = ProfilePatchInput.parse({ displayName: 'Mattia', giorniIncasso: 45 });
  assert.equal(r.displayName, 'Mattia');
  assert.equal(r.giorniIncasso, 45);
});

test('ProfilePatchInput — giorniIncasso negativo → errore', () => {
  assert.throws(() => ProfilePatchInput.parse({ giorniIncasso: -1 }));
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/shared/schemas.test.ts`
Expected: FAIL — `ProfileAnagrafica`/`ProfileAttivita`/`ProfilePatchInput` non esistono.

- [ ] **Step 3: Implementare gli schemi**

In `src/shared/schemas.ts`, dopo il blocco `// ───── Profiles ─────` (subito sotto `ProfileCreateInput`), aggiungere:

```ts
// Editor profilo (anagrafica/attività): tutti i campi opzionali, stringa vuota
// ammessa (postura permissiva — la validazione di formato è inline lato client,
// il blocco duro resta al confine XML in shared/cedente.ts).
const optStr = z.string().max(200).optional();
const upper = (s: string | undefined) => (s == null ? s : s.toUpperCase().trim());

const Indirizzo = z.object({
  indirizzo: optStr,
  cap: optStr,
  citta: optStr,
  provincia: z.string().max(200).optional().transform(upper),
});

export const ProfileAnagrafica = z.object({
  cf: z.string().max(200).optional().transform(upper),
  nome: optStr,
  cognome: optStr,
  sesso: optStr,
  data_nascita: optStr,
  comune_nascita: optStr,
  prov_nascita: z.string().max(200).optional().transform(upper),
  residenza: Indirizzo.optional(),
  domicilio_fiscale: Indirizzo.optional(),
  telefono: optStr,
  email: optStr,
  iban: optStr,
  modalita_pagamento: optStr,
});

export const ProfileAttivita = z.object({
  partita_iva: optStr,
  codice_ateco: optStr,
  ateco_gruppo: optStr,
  descrizione_attivita: optStr,
  comune_domicilio: optStr,
  data_inizio_attivita: optStr,
});

export const ProfilePatchInput = z.object({
  displayName: z.string().min(1).max(100).optional(),
  giorniIncasso: z.number().int().min(0).max(365).optional(),
  anagrafica: ProfileAnagrafica.optional(),
  attivita: ProfileAttivita.optional(),
});
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/shared/schemas.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts src/shared/schemas.test.ts
git commit -m "feat(shared): schemi editor profilo (anagrafica/attivita/patch)"
```

---

## Task 2: Backend `GET /api/profiles/active`

**Files:**
- Modify: `src/server/routes/profiles.ts`
- Test: `src/server/routes/profiles.test.ts`

- [ ] **Step 1: Scrivere il test (append in coda)**

In `src/server/routes/profiles.test.ts` aggiungere:

```ts
import { profiles } from '../db/schema';
import { eq } from 'drizzle-orm';

test('GET /api/profiles/active ritorna il profilo attivo con blob parsati', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);

  // semina blob JSON sul profilo default
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({
    anagrafica: JSON.stringify({ nome: 'Mario', residenza: { citta: 'Roma' } }),
    attivita: JSON.stringify({ partita_iva: '00743110157', regime_default: 'forfettario' }),
  }).where(eq(profiles.id, p!.id));

  const res = await app.request('/api/profiles/active', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.slug, 'default');
  assert.equal(body.profile.anagrafica.nome, 'Mario');
  assert.equal(body.profile.anagrafica.residenza.citta, 'Roma');
  assert.equal(body.profile.attivita.partita_iva, '00743110157');
  assert.equal(body.profile.attivita.regime_default, 'forfettario');
});

test('GET /api/profiles/active con blob null/malformato → oggetti vuoti', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({ anagrafica: 'not-json{', attivita: null }).where(eq(profiles.id, p!.id));

  const res = await app.request('/api/profiles/active', { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.profile.anagrafica, {});
  assert.deepEqual(body.profile.attivita, {});
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/server/routes/profiles.test.ts`
Expected: FAIL — `/api/profiles/active` ritorna 404 (route assente).

- [ ] **Step 3: Implementare GET /active**

In `src/server/routes/profiles.ts`:

(a) Aggiungere gli import in cima (estendere quelli esistenti):
```ts
import { ProfileCreateInput, ProfilePatchInput } from '@shared/schemas';
import { zJson } from '../middleware/validate';
```
(`zJson` è già importato nel file; `ProfilePatchInput` si aggiunge alla riga di import da `@shared/schemas`.)

(b) Aggiungere un helper di parse difensivo (sotto `toPublic`):
```ts
function parseBlob(v: string | null): Record<string, unknown> {
  if (!v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toFull(p: typeof profiles.$inferSelect) {
  return {
    id: p.id, slug: p.slug, displayName: p.displayName, giorniIncasso: p.giorniIncasso,
    anagrafica: parseBlob(p.anagrafica), attivita: parseBlob(p.attivita),
  };
}
```

(c) Aggiungere la route (prima di `POST /:slug/activate` per non far collidere `:slug` con `active`... in realtà sono path diversi, ma per chiarezza metterla subito dopo `GET /`):
```ts
profilesRoute.get('/active', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!row) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');
  return c.json({ profile: toFull(row) });
});
```

> NB: l'ordine delle route conta in Hono. `GET /active` è un path statico, `POST /:slug/activate` è un'altra coppia metodo+path: nessuna collisione. Ma assicurarsi che `/active` sia registrata e che non esista un `GET /:slug` generico (non esiste).

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/server/routes/profiles.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/profiles.ts src/server/routes/profiles.test.ts
git commit -m "feat(server): GET /api/profiles/active (profilo attivo con blob parsati)"
```

---

## Task 3: Backend `PATCH /api/profiles/active` (merge non distruttivo)

**Files:**
- Modify: `src/server/routes/profiles.ts`
- Test: `src/server/routes/profiles.test.ts`

- [ ] **Step 1: Scrivere i test (append in coda)**

In `src/server/routes/profiles.test.ts` aggiungere:

```ts
test('PATCH /api/profiles/active aggiorna anagrafica e displayName', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles/active', {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Mattia', anagrafica: { nome: 'Mattia', cf: 'rssmra80a01h501u' } }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.displayName, 'Mattia');
  assert.equal(body.profile.anagrafica.nome, 'Mattia');
  assert.equal(body.profile.anagrafica.cf, 'RSSMRA80A01H501U');
});

test('PATCH attivita preserva regime_default e chiavi extra non gestite dal form', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({
    attivita: JSON.stringify({ partita_iva: 'old', regime_default: 'forfettario', agevolazione_startup: true }),
  }).where(eq(profiles.id, p!.id));

  const res = await app.request('/api/profiles/active', {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ attivita: { partita_iva: '00743110157' } }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.attivita.partita_iva, '00743110157');     // aggiornato
  assert.equal(body.profile.attivita.regime_default, 'forfettario');  // preservato
  assert.equal(body.profile.attivita.agevolazione_startup, true);     // preservato
});

test('PATCH parziale: solo giorniIncasso non tocca i blob', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const [p] = await db.select().from(profiles).limit(1);
  await db.update(profiles).set({ anagrafica: JSON.stringify({ nome: 'X' }) }).where(eq(profiles.id, p!.id));

  const res = await app.request('/api/profiles/active', {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ giorniIncasso: 60 }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.giorniIncasso, 60);
  assert.equal(body.profile.anagrafica.nome, 'X'); // intatto
});

test('PATCH con body invalido (giorniIncasso negativo) → 400 VALIDATION', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'a@b.it', password: 'pw-super-lunga-123', name: 'A' });
  const app = makeApp(db);
  const cookie = await login(app);
  const res = await app.request('/api/profiles/active', {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ giorniIncasso: -5 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'VALIDATION');
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/server/routes/profiles.test.ts`
Expected: FAIL — PATCH `/active` non esiste (404/405).

- [ ] **Step 3: Implementare PATCH /active**

In `src/server/routes/profiles.ts`, dopo `GET /active`:

```ts
profilesRoute.patch('/active', zJson(ProfilePatchInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const patch = c.req.valid('json');

  const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!row) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');

  const update: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.displayName !== undefined) update.displayName = patch.displayName;
  if (patch.giorniIncasso !== undefined) update.giorniIncasso = patch.giorniIncasso;
  // merge non distruttivo: parte dal blob esistente, sovrascrive solo le chiavi presenti.
  if (patch.anagrafica !== undefined) {
    update.anagrafica = JSON.stringify({ ...parseBlob(row.anagrafica), ...patch.anagrafica });
  }
  if (patch.attivita !== undefined) {
    update.attivita = JSON.stringify({ ...parseBlob(row.attivita), ...patch.attivita });
  }

  await db.update(profiles).set(update).where(eq(profiles.id, profileId));
  const [updated] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  return c.json({ profile: toFull(updated!) });
});
```

> Nota merge: lo spread `{ ...esistente, ...patch }` è 1 livello. `residenza`/`domicilio_fiscale` sono oggetti annidati: il form li invia **sempre interi** (vedi Task 6), quindi la sostituzione a livello-1 dell'intero sotto-oggetto è corretta e non perde dati. `regime_default` e altre chiavi top-level non inviate sopravvivono.

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/server/routes/profiles.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/profiles.ts src/server/routes/profiles.test.ts
git commit -m "feat(server): PATCH /api/profiles/active (merge non distruttivo dei blob)"
```

---

## Task 4: Logica pura del form (`lib/profile-form.ts`)

**Files:**
- Create: `src/client/lib/profile-form.ts`
- Test: `src/client/lib/profile-form.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/lib/profile-form.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anagraficaDefaults, attivitaDefaults,
  anagraficaFromResponse, attivitaFromResponse,
  anagraficaToBody, attivitaToBody,
  copyResidenzaToDomicilio,
  fieldError,
} from './profile-form';

test('anagraficaDefaults: stringhe vuote, residenza/domicilio presenti', () => {
  const d = anagraficaDefaults();
  assert.equal(d.nome, '');
  assert.equal(d.residenza.citta, '');
  assert.equal(d.domicilio_fiscale.cap, '');
});

test('anagraficaFromResponse: legge i blob, default sui mancanti', () => {
  const s = anagraficaFromResponse({ nome: 'Mario', residenza: { citta: 'Roma' } });
  assert.equal(s.nome, 'Mario');
  assert.equal(s.cognome, '');
  assert.equal(s.residenza.citta, 'Roma');
  assert.equal(s.residenza.indirizzo, '');
  assert.equal(s.domicilio_fiscale.citta, '');
});

test('anagraficaToBody: produce oggetto con residenza/domicilio annidati', () => {
  const s = { ...anagraficaDefaults(), nome: 'Mario' };
  s.residenza.citta = 'Roma';
  const b = anagraficaToBody(s);
  assert.equal(b.nome, 'Mario');
  assert.equal((b.residenza as { citta: string }).citta, 'Roma');
});

test('attivitaFromResponse / attivitaToBody: round-trip campi attività', () => {
  const s = attivitaFromResponse({ partita_iva: '00743110157', codice_ateco: '62.01' });
  assert.equal(s.partita_iva, '00743110157');
  assert.equal(s.ateco_gruppo, '');
  const b = attivitaToBody(s);
  assert.equal(b.partita_iva, '00743110157');
  assert.equal('regime_default' in b, false); // non inviato (preservato lato server)
});

test('copyResidenzaToDomicilio: copia i 4 campi residenza in domicilio', () => {
  const s = anagraficaDefaults();
  s.residenza = { indirizzo: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'RM' };
  const out = copyResidenzaToDomicilio(s);
  assert.deepEqual(out.domicilio_fiscale, s.residenza);
});

test('fieldError: vuoto = nessun errore; formato sbagliato = messaggio', () => {
  assert.equal(fieldError('partita_iva', ''), null);
  assert.equal(fieldError('partita_iva', '123'), 'P.IVA non valida (11 cifre).');
  assert.equal(fieldError('partita_iva', '00743110157'), null);
  assert.equal(fieldError('cf', 'abc'), 'Codice fiscale non valido.');
  assert.equal(fieldError('cap', '123'), 'CAP non valido (5 cifre).');
  assert.equal(fieldError('cap', '00100'), null);
  assert.equal(fieldError('provincia', 'ROMA'), 'Provincia: 2 lettere.');
  assert.equal(fieldError('email', 'nope'), 'Email non valida.');
  assert.equal(fieldError('email', 'a@b.it'), null);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/lib/profile-form.test.ts`
Expected: FAIL — `./profile-form` non esiste.

- [ ] **Step 3: Implementare**

Create `src/client/lib/profile-form.ts`:

```ts
// src/client/lib/profile-form.ts
// Logica pura dell'editor di profilo (anagrafica/attività): defaults, mapping
// stato↔body, validatori di formato. Nessun DOM, nessun fetch. Condiviso fra
// pages/profilo-personale.ts e pages/profilo-piva.ts.

import { isValidPartitaIvaIT, isValidCodiceFiscaleFormat, isValidPec } from '@shared/validators';

export interface Indirizzo { indirizzo: string; cap: string; citta: string; provincia: string }

export interface AnagraficaState {
  cf: string; nome: string; cognome: string; sesso: string;
  data_nascita: string; comune_nascita: string; prov_nascita: string;
  residenza: Indirizzo; domicilio_fiscale: Indirizzo;
  telefono: string; email: string; iban: string; modalita_pagamento: string;
}

export interface AttivitaState {
  partita_iva: string; codice_ateco: string; ateco_gruppo: string;
  descrizione_attivita: string; comune_domicilio: string; data_inizio_attivita: string;
}

function s(v: unknown): string { return v == null ? '' : String(v); }
function indirizzo(v: unknown): Indirizzo {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { indirizzo: s(o['indirizzo']), cap: s(o['cap']), citta: s(o['citta']), provincia: s(o['provincia']) };
}

export function anagraficaDefaults(): AnagraficaState {
  return {
    cf: '', nome: '', cognome: '', sesso: '', data_nascita: '', comune_nascita: '', prov_nascita: '',
    residenza: { indirizzo: '', cap: '', citta: '', provincia: '' },
    domicilio_fiscale: { indirizzo: '', cap: '', citta: '', provincia: '' },
    telefono: '', email: '', iban: '', modalita_pagamento: '',
  };
}

export function attivitaDefaults(): AttivitaState {
  return {
    partita_iva: '', codice_ateco: '', ateco_gruppo: '', descrizione_attivita: '',
    comune_domicilio: '', data_inizio_attivita: '',
  };
}

export function anagraficaFromResponse(a: Record<string, unknown>): AnagraficaState {
  return {
    cf: s(a['cf']), nome: s(a['nome']), cognome: s(a['cognome']), sesso: s(a['sesso']),
    data_nascita: s(a['data_nascita']), comune_nascita: s(a['comune_nascita']), prov_nascita: s(a['prov_nascita']),
    residenza: indirizzo(a['residenza']), domicilio_fiscale: indirizzo(a['domicilio_fiscale']),
    telefono: s(a['telefono']), email: s(a['email']), iban: s(a['iban']), modalita_pagamento: s(a['modalita_pagamento']),
  };
}

export function attivitaFromResponse(a: Record<string, unknown>): AttivitaState {
  return {
    partita_iva: s(a['partita_iva']), codice_ateco: s(a['codice_ateco']), ateco_gruppo: s(a['ateco_gruppo']),
    descrizione_attivita: s(a['descrizione_attivita']), comune_domicilio: s(a['comune_domicilio']),
    data_inizio_attivita: s(a['data_inizio_attivita']),
  };
}

export function anagraficaToBody(st: AnagraficaState): Record<string, unknown> {
  return { ...st, residenza: { ...st.residenza }, domicilio_fiscale: { ...st.domicilio_fiscale } };
}

export function attivitaToBody(st: AttivitaState): Record<string, unknown> {
  return { ...st };
}

export function copyResidenzaToDomicilio(st: AnagraficaState): AnagraficaState {
  return { ...st, domicilio_fiscale: { ...st.residenza } };
}

// ── validatori di formato (vuoto = OK, postura permissiva) ──
export type FieldKind = 'partita_iva' | 'cf' | 'cap' | 'provincia' | 'email';

export function fieldError(kind: FieldKind, value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  switch (kind) {
    case 'partita_iva': return isValidPartitaIvaIT(v.replace(/\s+/g, '')) ? null : 'P.IVA non valida (11 cifre).';
    case 'cf': return isValidCodiceFiscaleFormat(v) ? null : 'Codice fiscale non valido.';
    case 'cap': return /^\d{5}$/.test(v) ? null : 'CAP non valido (5 cifre).';
    case 'provincia': return /^[A-Za-z]{2}$/.test(v) ? null : 'Provincia: 2 lettere.';
    case 'email': return isValidPec(v) ? null : 'Email non valida.';
  }
}
```

> NB: `isValidPec` in `shared/validators.ts` è una regex email generica (`^[^@\s]+@[^@\s]+\.[^@\s]+$`, verificato) — adatta anche per l'email ordinaria.

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/lib/profile-form.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/profile-form.ts src/client/lib/profile-form.test.ts
git commit -m "feat(client): logica pura editor profilo (profile-form)"
```

---

## Task 5: Render puri — Profilo personale

**Files:**
- Create: `src/client/pages/profilo-personale.ts` (parte 1: render puri)
- Test: `src/client/pages/profilo-personale.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/pages/profilo-personale.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderForm } from './profilo-personale';
import { anagraficaDefaults } from '../lib/profile-form';

test('renderForm: campi identificativi e displayName presenti', () => {
  const html = renderForm('Mattia', anagraficaDefaults());
  assert.match(html, /data-field="displayName"/);
  assert.match(html, /value="Mattia"/);
  assert.match(html, /data-field="nome"/);
  assert.match(html, /data-field="cognome"/);
  assert.match(html, /data-field="cf"/);
  assert.match(html, /Salva/);
});

test('renderForm: sezioni residenza e domicilio fiscale con campi annidati', () => {
  const html = renderForm('X', anagraficaDefaults());
  assert.match(html, /data-field="residenza.indirizzo"/);
  assert.match(html, /data-field="residenza.cap"/);
  assert.match(html, /data-field="domicilio_fiscale.citta"/);
  assert.match(html, /data-same-domicilio/); // checkbox "uguale a residenza"
});

test('renderForm: recapiti (telefono/email/iban/modalita)', () => {
  const html = renderForm('X', anagraficaDefaults());
  assert.match(html, /data-field="telefono"/);
  assert.match(html, /data-field="email"/);
  assert.match(html, /data-field="iban"/);
  assert.match(html, /data-field="modalita_pagamento"/);
});

test('renderForm: pre-popola i valori esistenti', () => {
  const st = anagraficaDefaults();
  st.nome = 'Mario';
  st.residenza.citta = 'Roma';
  const html = renderForm('X', st);
  assert.match(html, /value="Mario"/);
  assert.match(html, /value="Roma"/);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/pages/profilo-personale.test.ts`
Expected: FAIL — `./profilo-personale` non esiste.

- [ ] **Step 3: Implementare i render puri**

Create `src/client/pages/profilo-personale.ts` (solo render + import; mount nel Task 6):

```ts
// src/client/pages/profilo-personale.ts
//
// Pagina "Profilo personale" (/profilo-personale): editor dei dati anagrafici
// del profilo attivo (profiles.anagrafica) + displayName. Raggiunta dal menu
// profilo. Render puri (testabili) + mount con fetch/save. Backend:
// GET/PATCH /api/profiles/active.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import {
  anagraficaDefaults, anagraficaFromResponse, anagraficaToBody, copyResidenzaToDomicilio,
  fieldError, type AnagraficaState,
} from '../lib/profile-form';

// ── render puri ──

function txt(field: string, label: string, value: string, attrs = ''): string {
  return `<div class="pf-field">
    <label>${esc(label)}</label>
    <input type="text" data-field="${esc(field)}" value="${esc(value)}" ${attrs}>
    <span class="pf-err" data-err="${esc(field)}"></span>
  </div>`;
}

function indirizzoBlock(prefix: 'residenza' | 'domicilio_fiscale', v: AnagraficaState['residenza']): string {
  return `<div class="ys-grid">
    ${txt(`${prefix}.indirizzo`, 'Indirizzo', v.indirizzo)}
    ${txt(`${prefix}.cap`, 'CAP', v.cap)}
    ${txt(`${prefix}.citta`, 'Città', v.citta)}
    ${txt(`${prefix}.provincia`, 'Provincia', v.provincia)}
  </div>`;
}

export function renderForm(displayName: string, s: AnagraficaState): string {
  return `<form class="card ys-form" data-pf-form>
    <h3 class="pf-h">Identificativi</h3>
    <div class="ys-grid">
      ${txt('displayName', 'Nome profilo (visualizzato)', displayName)}
      ${txt('cf', 'Codice fiscale', s.cf)}
      ${txt('nome', 'Nome', s.nome)}
      ${txt('cognome', 'Cognome', s.cognome)}
      ${txt('sesso', 'Sesso (M/F)', s.sesso)}
      ${txt('data_nascita', 'Data di nascita', s.data_nascita, 'placeholder="AAAA-MM-GG"')}
      ${txt('comune_nascita', 'Comune di nascita', s.comune_nascita)}
      ${txt('prov_nascita', 'Provincia di nascita', s.prov_nascita)}
    </div>

    <h3 class="pf-h">Residenza</h3>
    ${indirizzoBlock('residenza', s.residenza)}

    <h3 class="pf-h">Domicilio fiscale
      <label class="pf-same"><input type="checkbox" data-same-domicilio> uguale alla residenza</label>
    </h3>
    <div data-domicilio-wrap>${indirizzoBlock('domicilio_fiscale', s.domicilio_fiscale)}</div>

    <h3 class="pf-h">Recapiti</h3>
    <div class="ys-grid">
      ${txt('telefono', 'Telefono', s.telefono)}
      ${txt('email', 'Email', s.email)}
      ${txt('iban', 'IBAN', s.iban)}
      ${txt('modalita_pagamento', 'Modalità di pagamento', s.modalita_pagamento)}
    </div>

    <div class="ys-actions">
      <span class="ys-msg" data-pf-msg></span>
      <button type="button" class="btn" data-pf-reset>Annulla</button>
      <button type="submit" class="btn btn-primary">Salva</button>
    </div>
  </form>`;
}

export function renderPage(displayName: string, s: AnagraficaState): string {
  return `<div class="ys-page">
    <div class="ys-crumb">Profilo ▸ Profilo personale</div>
    <h2>Profilo personale</h2>
    ${renderForm(displayName, s)}
  </div>`;
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/pages/profilo-personale.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS. (Import `api`/`ApiError`/`mountPage`/`anagraficaFromResponse`/`anagraficaToBody`/`copyResidenzaToDomicilio`/`fieldError`/`anagraficaDefaults` non ancora usati: ok, servono al Task 6; tsconfig non ha `noUnusedLocals`.)

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/profilo-personale.ts src/client/pages/profilo-personale.test.ts
git commit -m "feat(client): render puri Profilo personale (form anagrafica)"
```

---

## Task 6: mount() — Profilo personale (fetch / save / reset / domicilio)

**Files:**
- Modify: `src/client/pages/profilo-personale.ts` (append `mount`)

- [ ] **Step 1: Append `mount`**

In coda a `src/client/pages/profilo-personale.ts`:

```ts
// ── mount ──

interface ActiveProfileResponse {
  profile: { displayName: string; anagrafica: Record<string, unknown> };
}

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/profilo-personale',
    render: async ({ main }) => {
      main.innerHTML = `<div class="card ys-note">Carico il profilo…</div>`;

      let displayName = '';
      let state: AnagraficaState;
      try {
        const resp = await api.get<ActiveProfileResponse>('/api/profiles/active');
        displayName = resp.profile.displayName;
        state = anagraficaFromResponse(resp.profile.anagrafica);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare il profilo. Riprova.';
        main.innerHTML = `<div class="card ys-note ys-note-warn">${esc(msg)}</div>`;
        return;
      }

      function validateAll(): void {
        const checks: Array<[string, ReturnType<typeof fieldError> extends infer R ? string : never] | [string, string | null]> = [];
        const set = (field: string, msg: string | null) => {
          const el = main.querySelector<HTMLElement>(`[data-err="${field}"]`);
          if (el) el.textContent = msg ?? '';
        };
        set('cf', fieldError('cf', state.cf));
        set('email', fieldError('email', state.email));
        set('residenza.cap', fieldError('cap', state.residenza.cap));
        set('residenza.provincia', fieldError('provincia', state.residenza.provincia));
        set('domicilio_fiscale.cap', fieldError('cap', state.domicilio_fiscale.cap));
        set('domicilio_fiscale.provincia', fieldError('provincia', state.domicilio_fiscale.provincia));
        set('prov_nascita', fieldError('provincia', state.prov_nascita));
        void checks;
      }

      function render(): void {
        main.innerHTML = renderPage(displayName, state);
        const form = main.querySelector<HTMLFormElement>('[data-pf-form]')!;
        const msgEl = main.querySelector<HTMLElement>('[data-pf-msg]')!;

        // bind di tutti gli input text (top-level e annidati via "a.b")
        main.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((el) => {
          const field = el.dataset['field']!;
          el.addEventListener('input', () => {
            if (field === 'displayName') { displayName = el.value; return; }
            if (field.includes('.')) {
              const [grp, key] = field.split('.') as ['residenza' | 'domicilio_fiscale', keyof AnagraficaState['residenza']];
              state[grp][key] = el.value;
            } else {
              (state as unknown as Record<string, string>)[field] = el.value;
            }
            validateAll();
          });
        });

        // "domicilio = residenza"
        const same = main.querySelector<HTMLInputElement>('[data-same-domicilio]');
        const wrap = main.querySelector<HTMLElement>('[data-domicilio-wrap]');
        same?.addEventListener('change', () => {
          if (same.checked) {
            state = copyResidenzaToDomicilio(state);
            if (wrap) wrap.style.display = 'none';
            render();
          } else if (wrap) {
            wrap.style.display = '';
          }
        });

        main.querySelector<HTMLButtonElement>('[data-pf-reset]')?.addEventListener('click', () => render());

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          msgEl.textContent = 'Salvataggio…';
          msgEl.className = 'ys-msg';
          try {
            const resp = await api.patch<ActiveProfileResponse>('/api/profiles/active', {
              displayName,
              anagrafica: anagraficaToBody(state),
            });
            displayName = resp.profile.displayName;
            state = anagraficaFromResponse(resp.profile.anagrafica);
            render();
            const m = main.querySelector<HTMLElement>('[data-pf-msg]');
            if (m) { m.textContent = 'Salvato ✓'; m.className = 'ys-msg is-ok'; }
          } catch (err) {
            const text = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
            msgEl.textContent = text;
            msgEl.className = 'ys-msg is-err';
          }
        });

        validateAll();
      }

      render();
    },
  });
}
```

> NB sul tipo `checks`: rimuoverlo — è un residuo. La versione corretta del blocco `validateAll` è senza l'array `checks`:
> ```ts
> function validateAll(): void {
>   const set = (field: string, msg: string | null) => {
>     const el = main.querySelector<HTMLElement>(`[data-err="${field}"]`);
>     if (el) el.textContent = msg ?? '';
>   };
>   set('cf', fieldError('cf', state.cf));
>   set('email', fieldError('email', state.email));
>   set('residenza.cap', fieldError('cap', state.residenza.cap));
>   set('residenza.provincia', fieldError('provincia', state.residenza.provincia));
>   set('domicilio_fiscale.cap', fieldError('cap', state.domicilio_fiscale.cap));
>   set('domicilio_fiscale.provincia', fieldError('provincia', state.domicilio_fiscale.provincia));
>   set('prov_nascita', fieldError('provincia', state.prov_nascita));
> }
> ```
> Usare questa forma pulita.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Confermare i test render ancora verdi**

Run: `node --import tsx --test src/client/pages/profilo-personale.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/profilo-personale.ts
git commit -m "feat(client): mount Profilo personale (fetch/save/reset, domicilio=residenza)"
```

---

## Task 7: Render puri — Profilo P.IVA

**Files:**
- Create: `src/client/pages/profilo-piva.ts` (parte 1: render puri)
- Test: `src/client/pages/profilo-piva.test.ts`

- [ ] **Step 1: Scrivere il test**

Create `src/client/pages/profilo-piva.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderForm } from './profilo-piva';
import { attivitaDefaults } from '../lib/profile-form';

test('renderForm: campi attività e giorniIncasso presenti', () => {
  const html = renderForm(attivitaDefaults(), 30);
  assert.match(html, /data-field="partita_iva"/);
  assert.match(html, /data-field="codice_ateco"/);
  assert.match(html, /data-field="descrizione_attivita"/);
  assert.match(html, /data-field="comune_domicilio"/);
  assert.match(html, /data-field="data_inizio_attivita"/);
  assert.match(html, /data-field="giorniIncasso"/);
  assert.match(html, /value="30"/);
});

test('renderForm: select gruppo ATECO popolata (9 gruppi) e pre-selezione', () => {
  const st = attivitaDefaults();
  st.ateco_gruppo = '0.78';
  const html = renderForm(st, 30);
  assert.match(html, /data-field="ateco_gruppo"/);
  const opts = (html.match(/<option /g) ?? []).length;
  assert.ok(opts >= 9, `attesi >=9 option, trovati ${opts}`);
});

test('renderForm: nota startup 5% con link a /impostazioni sulla data inizio', () => {
  const html = renderForm(attivitaDefaults(), 30);
  assert.match(html, /startup 5%/i);
  assert.match(html, /data-route="\/impostazioni"/);
});

test('renderForm: pre-popola i valori esistenti', () => {
  const st = attivitaDefaults();
  st.partita_iva = '00743110157';
  const html = renderForm(st, 45);
  assert.match(html, /value="00743110157"/);
  assert.match(html, /value="45"/);
});
```

- [ ] **Step 2: Verificare FAIL**

Run: `node --import tsx --test src/client/pages/profilo-piva.test.ts`
Expected: FAIL — `./profilo-piva` non esiste.

- [ ] **Step 3: Implementare i render puri**

Create `src/client/pages/profilo-piva.ts` (solo render + import; mount nel Task 8):

```ts
// src/client/pages/profilo-piva.ts
//
// Pagina "Profilo P.IVA" (/profilo-piva): editor dei dati di attività del
// profilo attivo (profiles.attivita) + giorniIncasso. Raggiunta dal menu
// profilo. Render puri (testabili) + mount con fetch/save. Backend:
// GET/PATCH /api/profiles/active. La data inizio attività alimenta il
// controllo startup 5% in /impostazioni (year-settings).

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { atecoGruppiUI } from '@shared/ateco-coefficienti';
import {
  attivitaDefaults, attivitaFromResponse, attivitaToBody, fieldError, type AttivitaState,
} from '../lib/profile-form';

// ── render puri ──

function txt(field: string, label: string, value: string, attrs = ''): string {
  return `<div class="pf-field">
    <label>${esc(label)}</label>
    <input type="text" data-field="${esc(field)}" value="${esc(value)}" ${attrs}>
    <span class="pf-err" data-err="${esc(field)}"></span>
  </div>`;
}

function atecoSelect(selected: string): string {
  const opts = atecoGruppiUI().map((g) => {
    const val = String(g.coefficiente); // es. "0.78"
    const pct = Math.round(g.coefficiente * 100) + '%';
    return `<option value="${esc(val)}"${val === selected ? ' selected' : ''}>${esc(g.label)} — ${esc(pct)}</option>`;
  }).join('');
  return `<div class="pf-field">
    <label>Gruppo ATECO (coefficiente)</label>
    <select data-field="ateco_gruppo"><option value="">—</option>${opts}</select>
  </div>`;
}

export function renderForm(s: AttivitaState, giorniIncasso: number): string {
  return `<form class="card ys-form" data-pf-form>
    <h3 class="pf-h">Attività</h3>
    <div class="ys-grid">
      ${txt('partita_iva', 'Partita IVA', s.partita_iva)}
      ${txt('codice_ateco', 'Codice ATECO', s.codice_ateco, 'placeholder="es. 62.01.00"')}
      ${txt('descrizione_attivita', 'Descrizione attività', s.descrizione_attivita)}
      ${atecoSelect(s.ateco_gruppo)}
      ${txt('comune_domicilio', 'Comune domicilio attività', s.comune_domicilio)}
      <div class="pf-field">
        <label>Data inizio attività</label>
        <input type="text" data-field="data_inizio_attivita" value="${esc(s.data_inizio_attivita)}" placeholder="AAAA-MM-GG">
        <span class="ys-hint">Determina l'anno di apertura: alimenta il controllo <a href="/impostazioni" data-route="/impostazioni">startup 5%</a> nelle Impostazioni.</span>
      </div>
    </div>

    <h3 class="pf-h">Fatturazione</h3>
    <div class="ys-grid">
      <div class="pf-field">
        <label>Giorni incasso (default scadenza pagamento)</label>
        <input type="number" data-field="giorniIncasso" value="${esc(giorniIncasso)}" step="1" min="0" max="365">
      </div>
    </div>

    <div class="ys-actions">
      <span class="ys-msg" data-pf-msg></span>
      <button type="button" class="btn" data-pf-reset>Annulla</button>
      <button type="submit" class="btn btn-primary">Salva</button>
    </div>
  </form>`;
}

export function renderPage(s: AttivitaState, giorniIncasso: number): string {
  return `<div class="ys-page">
    <div class="ys-crumb">Profilo ▸ Profilo P.IVA</div>
    <h2>Profilo P.IVA</h2>
    ${renderForm(s, giorniIncasso)}
  </div>`;
}
```

- [ ] **Step 4: Verificare PASS** + typecheck

Run: `node --import tsx --test src/client/pages/profilo-piva.test.ts`
Run: `npm run typecheck`
Expected: PASS / PASS. (Import non ancora usati servono al Task 8: ok.)

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/profilo-piva.ts src/client/pages/profilo-piva.test.ts
git commit -m "feat(client): render puri Profilo P.IVA (form attività + giorni incasso)"
```

---

## Task 8: mount() — Profilo P.IVA (fetch / save / reset)

**Files:**
- Modify: `src/client/pages/profilo-piva.ts` (append `mount`)

- [ ] **Step 1: Append `mount`**

In coda a `src/client/pages/profilo-piva.ts`:

```ts
// ── mount ──

interface ActiveProfileResponse {
  profile: { giorniIncasso: number; attivita: Record<string, unknown> };
}

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/profilo-piva',
    render: async ({ main }) => {
      main.innerHTML = `<div class="card ys-note">Carico il profilo…</div>`;

      let giorni = 30;
      let state: AttivitaState;
      try {
        const resp = await api.get<ActiveProfileResponse>('/api/profiles/active');
        giorni = resp.profile.giorniIncasso;
        state = attivitaFromResponse(resp.profile.attivita);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare il profilo. Riprova.';
        main.innerHTML = `<div class="card ys-note ys-note-warn">${esc(msg)}</div>`;
        return;
      }

      function validateAll(): void {
        const el = main.querySelector<HTMLElement>('[data-err="partita_iva"]');
        if (el) el.textContent = fieldError('partita_iva', state.partita_iva) ?? '';
      }

      function render(): void {
        main.innerHTML = renderPage(state, giorni);
        const form = main.querySelector<HTMLFormElement>('[data-pf-form]')!;
        const msgEl = main.querySelector<HTMLElement>('[data-pf-msg]')!;

        main.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach((el) => {
          const field = el.dataset['field']!;
          el.addEventListener('input', () => {
            if (field === 'giorniIncasso') { giorni = Number((el as HTMLInputElement).value) || 0; return; }
            (state as unknown as Record<string, string>)[field] = el.value;
            validateAll();
          });
          // i <select> emettono 'change', non 'input' in alcuni browser: copri entrambi
          el.addEventListener('change', () => {
            if (field === 'giorniIncasso') { giorni = Number((el as HTMLInputElement).value) || 0; return; }
            (state as unknown as Record<string, string>)[field] = el.value;
          });
        });

        main.querySelector<HTMLButtonElement>('[data-pf-reset]')?.addEventListener('click', () => render());

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          msgEl.textContent = 'Salvataggio…';
          msgEl.className = 'ys-msg';
          try {
            const resp = await api.patch<ActiveProfileResponse>('/api/profiles/active', {
              giorniIncasso: giorni,
              attivita: attivitaToBody(state),
            });
            giorni = resp.profile.giorniIncasso;
            state = attivitaFromResponse(resp.profile.attivita);
            render();
            const m = main.querySelector<HTMLElement>('[data-pf-msg]');
            if (m) { m.textContent = 'Salvato ✓'; m.className = 'ys-msg is-ok'; }
          } catch (err) {
            const text = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
            msgEl.textContent = text;
            msgEl.className = 'ys-msg is-err';
          }
        });

        validateAll();
      }

      render();
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Confermare i test render ancora verdi**

Run: `node --import tsx --test src/client/pages/profilo-piva.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/profilo-piva.ts
git commit -m "feat(client): mount Profilo P.IVA (fetch/save/reset)"
```

---

## Task 9: Routing — collegare le due pagine

**Files:**
- Modify: `src/client/main.ts`

- [ ] **Step 1: Sostituire i due placeholder**

In `src/client/main.ts`, nel mapping `routes`, sostituire:
```ts
  '/profilo-personale': () => import('./pages/placeholder'),
  '/profilo-piva': () => import('./pages/placeholder'),
```
con:
```ts
  '/profilo-personale': () => import('./pages/profilo-personale'),
  '/profilo-piva': () => import('./pages/profilo-piva'),
```

- [ ] **Step 2: Typecheck + build web**

Run: `npm run typecheck`
Run: `npm run build:web`
Expected: PASS / build OK.

- [ ] **Step 3: Commit**

```bash
git add src/client/main.ts
git commit -m "feat(client): route /profilo-personale e /profilo-piva alle pagine reali"
```

---

## Task 10: Stili (form profilo)

**Files:**
- Modify: `src/client/styles/index.css`

- [ ] **Step 1: Appendere gli stili**

In coda a `src/client/styles/index.css` (riusa `.ys-grid`/`.ys-field`/`.ys-form`/`.ys-actions`/`.ys-msg`/`.ys-hint`/`.ys-note` già definiti dallo slice Impostazioni):

```css
/* ── Form profilo (personale / P.IVA) ───────────────────────────────── */
.pf-h { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text2); margin: 18px 0 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pf-h:first-child { margin-top: 0; }
.pf-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 4px; }
.pf-field > label { font-size: .78rem; color: var(--text2); }
.pf-same { font-size: .74rem; color: var(--text3); font-weight: 500; text-transform: none; letter-spacing: 0; display: flex; align-items: center; gap: 6px; }
.pf-err { font-size: .68rem; color: var(--color-error); min-height: .8em; }
```

- [ ] **Step 2: Build web**

Run: `npm run build:web`
Expected: build OK senza errori CSS.

- [ ] **Step 3: Commit**

```bash
git add src/client/styles/index.css
git commit -m "style(client): stili form profilo (pf-*)"
```

---

## Task 11: Verifica finale

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: tutti i test verdi (inclusi: schemas profilo, profiles GET/PATCH, profile-form, render delle due pagine). NB: su Windows un raro fallimento flaky di `scadenziario-service.test.ts` sotto run parallela è benigno (contesa DB temp libsql) — rieseguire in isolamento.

- [ ] **Step 2: Typecheck + build completa**

Run: `npm run typecheck`
Run: `npm run build`
Expected: PASS / build web+server OK.

- [ ] **Step 3: Smoke manuale (raccomandato)**

`npm run dev`, login → menu profilo (footer) → "Profilo personale": modifica nome/CF/residenza, spunta "domicilio = residenza" (copia e nasconde il blocco), Salva → "Salvato ✓"; ricarica → valori persistiti; il nome profilo aggiornato appare nella sidebar. → "Profilo P.IVA": imposta P.IVA (formato errato segnala ma non blocca), gruppo ATECO, data inizio, giorni incasso, Salva → persistito. Verifica che il `regime_default` (se presente dall'import) non venga perso dopo un salvataggio P.IVA. Verifica che la data inizio impostata renda coerente il check startup 5% in Impostazioni.

---

## Self-Review (compilata in stesura)

**Spec coverage:**
- Schemi `ProfileAnagrafica`/`ProfileAttivita`/`ProfilePatchInput` (no legacy inerti, `regime_default` fuori dall'input) → Task 1. ✓
- `GET /api/profiles/active` (blob parsati, null/malformato→{}) → Task 2. ✓
- `PATCH /api/profiles/active` merge non distruttivo (preserva `regime_default`+chiavi extra), patch parziale, 400 su invalido → Task 3. ✓
- Logica pura condivisa (defaults, from/to, copyResidenza, validatori permissivi) → Task 4. ✓
- Profilo personale: port fedele anagrafica completa (identificativi, residenza, domicilio fiscale + "uguale a residenza", recapiti) + displayName → Task 5+6. ✓
- Profilo P.IVA: attività completa (P.IVA, ATECO+gruppo, descrizione, comune, data inizio + nota startup) + giorniIncasso → Task 7+8. ✓
- Validazione permissiva + warning di formato inline (non bloccante) → Task 4 `fieldError` + Task 6/8 `validateAll`. ✓
- Routing placeholder→reali → Task 9. ✓
- Stili → Task 10. ✓
- Scoping profilo attivo in sessione (`c.get('activeProfileId')`) → Task 2/3. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha codice completo. (Task 6 contiene una nota esplicita che corregge un residuo `checks` in `validateAll` → usare la forma pulita riportata.)

**Type consistency:** `AnagraficaState`/`AttivitaState`/`Indirizzo` definiti in Task 4, usati in Task 5–8. `fieldError(kind, value)` firma coerente fra Task 4 e usi in Task 6/8. `atecoGruppiUI()` (già esistente dallo slice Impostazioni) ritorna `{label, coefficiente}` — usato in Task 7 con `String(coefficiente)` come valore option, coerente con `ateco_gruppo` stringa. Endpoint `{ profile: {…} }` shape identico in GET (Task 2) e PATCH (Task 3) e consumato uguale in Task 6/8.

**Nota di rischio:** in Task 6 il bind annidato `state[grp][key]` usa un cast tipizzato sui due gruppi `residenza|domicilio_fiscale`: se TS si lamenta, ripiegare su `(state[grp] as Record<string,string>)[key] = el.value`. L'uso di `isValidPec` per l'email ordinaria è OK (regex email generica, verificata).
