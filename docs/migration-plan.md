# Migration Plan: CalcoliVari → Lira

## Strategia

**Non in-place.** CalcoliVari resta in produzione finché Lira non è completa. Quando Lira è pronta, si fa un'unica migrazione dati (import JSON export di CalcoliVari) e poi si switcha l'utente. Nessun periodo di "dual-write".

## Fasi

### Fase 1 — Foundation (questa)
- [x] Scaffolding repo + tooling (Vite, TS, Hono, Drizzle, Docker, Fly)
- [x] Documentazione `architecture`, `data-model`, `migration-plan`
- [x] CLAUDE.md
- [x] Skills ereditate
- [ ] Schema DB Drizzle (bozza)
- [ ] Hono server entry + health check
- [ ] Setup Turso DB (manuale, da fare l'utente: `turso db create lira-prod`)
- [ ] Prima migration applicata

### Fase 2 — Auth
- [ ] `POST /api/auth/register` (Argon2id)
- [ ] `POST /api/auth/login` + session creation
- [ ] `POST /api/auth/logout`
- [ ] Middleware `requireSession`
- [ ] UI login/register/logout
- [ ] Switch profilo attivo

### Fase 3 — Profili + Anagrafica
- [ ] CRUD profili (un user → N profili)
- [ ] Anagrafica + attività
- [ ] Year settings (regime, INPS, coefficiente, riduzione 35%, primo anno)
- [ ] Form UI con dark theme portato da CalcoliVari

### Fase 4 — Clienti
- [x] CRUD clienti (`/api/clienti` scoped al profilo + pagina `/clienti` lista/ricerca/modal) (Slice 4A, 2026-06-06)
- [x] Autofill da P.IVA (`GET /lookup/:piva`, openapi.com, key da env, degrado 503) (Slice 4A, 2026-06-06)
- [x] Cliente default (colonna `is_default`, invariante ≤1 per profilo in transazione) (Slice 4A, 2026-06-06)
- [x] Validation server-side: P.IVA IT check-digit, CF formato, SDI/IPA per tipo, PEC; envelope `400 VALIDATION` (Slice 4A, 2026-06-06)

### Fase 5 — Fatture (modulo principale)
- [x] Creazione fattura via modal (TD01) + numerazione atomica all'invio (Slice 5A, 2026-06-08)
- [x] Storico fatture (tabella, filtri, stato) + pagina `/fatture` (Slice 5A, 2026-06-08)
- [x] State machine bozza → inviata → pagata (+ annulla-pagamento); NC TD04 → stornata rinviata a 5B (Slice 5A, 2026-06-08)
- [ ] Generazione XML FatturaPA v1.2 (TD01 + TD04) — porta logica da CalcoliVari
- [ ] PDF (jspdf) — porta layout minimalista
- [ ] Validators server-side (regime/ritenuta, IPA, prefisso paese UE, ecc.)
- [ ] Import XML (nuove + legacy)

### Fase 6 — Scadenziario + Pagamenti
- [ ] Tax engine (port da CalcoliVari `tax-engine.js` → `src/server/lib/tax-engine.ts`)
- [ ] Build schedule per anno (storico/previsionale)
- [ ] Soglie acconto art. 17 DPR 435/2001
- [ ] Slittamento festivi (`buildRolledDueDate`)
- [ ] F24 guida + codici tributo (1790/1791/1792, 2521-2524, 3850, ecc.)
- [ ] CRUD pagamenti + "segna pagato" quick action
- [ ] Cross-year (saldo N-1 + acconti N)
- [ ] **Fix dei rilievi audit 25/05/2026** (vedi commit history CalcoliVari):
  - C1: warning/blocco soglia uscita 100k €
  - C2: regime ordinario emette N1/N6.x, non N2.2
  - C3: bollo Q4 28/02 con slittamento festivi
  - C4: blocco export PDF dichiarazione se errori critici
  - C5: integrativa con calcolo delta o blocco
  - A1: imposta sostitutiva startup 5% (flag attivo)
  - A2: P.IVA cedente XML in fail-fast (non warning)
  - A3: contributo integrativo coerente UI/XML
  - A4: crediti CE non scomputabili da LM
  - A5: proroga saldo propagata al 1° acconto
  - A6: saldo sottrae acconti realmente pagati (non stimati)
  - M1-M6: vari (warning INPS 35%, NC ImportoPagamento, soglie 51,65/257,52, ATECO 6 cifre, RX1 limite F24)

### Fase 7 — Calendario + Budget + Spese
- [ ] Calendar entries (giorni lavorati/ferie/festivi)
- [ ] Budget items con drag-and-drop ordine
- [ ] Spese deducibili (ordinario)

### Fase 8 — Dichiarazione Redditi PF
- [ ] Quadri LM/RR/RS/RX/RW
- [ ] Wizard 12-step
- [ ] Export JSON + CSV
- [ ] Export PDF ministeriale con watermark BOZZA + disclaimer

### Fase 9 — Import legacy + Switch
- [x] `scripts/import-from-calcolivari.ts`: accetta uno o più JSON export di CalcoliVari, mappa al nuovo schema, idempotente, dry-run mode (Slice 3, 2026-06-06)
- [ ] Test su backup Mattia + Peru
- [ ] Deploy Fly produzione
- [ ] User acceptance + 1 settimana parallel run
- [ ] Switch DNS / shortcut
- [ ] CalcoliVari → read-only (no nuove modifiche)

### Fase 10 — Hardening
- [ ] Test E2E (Playwright) sui flussi critici (login, fattura, F24 download, dichiarazione)
- [ ] Backup automatico settimanale su R2
- [ ] Audit log per modifiche fatture/pagamenti (chi/quando/cosa)
- [ ] Rate limiting su `/api/auth/*`
- [ ] CSP + security headers

## Cose da NON portare da CalcoliVari

- Pattern `script-binding globals` (`data`, `currentProfile`, `currentYear`). In Lira tutto è ESM modules + parametri espliciti.
- Sistema di migrazioni one-shot via flag in localStorage. In Lira → Drizzle migrations versionate.
- `firebase-sync.js` e tutto il modello bidirezionale.
- Test runner custom in `test/run-tests.js`. In Lira → `node --test` con `tsx`.
- Skills duplicati / non più usati: revisione individuale prima del copy.
- `fatturazione-creator` skill: mantenuta solo se ancora utile.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Importer rompe i dati Mattia/Peru | Dry-run obbligatorio + diff manuale prima del commit definitivo. Snapshot JSON di backup PRE-import |
| Fly VM 512MB OOM con Argon2 | Argon2 con memoryCost tunato (default 64MB OK su 512); test con `ab` prima del go-live |
| Turso quota esaurita | Quota free 9GB e 1 miliardo righe lette/mese: per 3 utenti irrealizzabile saturarla |
| Cold start Fly > 5s | `min_machines_running = 1` se necessario (costa qualche $/mese) |
| Nuove regressioni fiscali | Port test suite di CalcoliVari + aggiungere test per i 14 rilievi audit |
| Utente perde fiducia per altre perdite dati | Backup automatico R2 + audit log + UI "ripristina versione precedente" su fatture |
