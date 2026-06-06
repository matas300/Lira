# Slice 5A — Fatture core (Design / Spec)

- **Data:** 2026-06-06
- **Stato:** approvato (brainstorm), in attesa review spec
- **Slice:** 5A (prima sotto-slice di Fase 5 — Fatture, decomposta)
- **Predecessore:** Slice 4A (Clienti) su `main`
- **Workflow:** brainstorm → **spec (questo doc)** → writing-plans → subagent-driven execute

---

## 1. Obiettivo & scope

Nucleo del **modulo Fatture** come vertical slice: backend (CRUD `/api/fatture` scoped al profilo + validatori server-side + numerazione atomica + state machine) **e** frontend (pagina `/fatture` con tabella, filtri, modal create/edit, "segna pagata" inline). Solo **TD01**.

Riusa i pattern stabiliti da 4A: route à la `pagamenti.ts`, `zJson`/`HttpError`, `modal.ts`, `pages/*.ts` mount/unmount, validatori puri in `@shared`.

**Decomposizione Fase 5 (contesto):** 5A Fatture core (questo doc) · 5B XML FatturaPA TD01/TD04 + Note di Credito · 5C PDF (jspdf) · 5D Import XML (nuove + legacy). Ogni slice ha proprio spec → plan → execute.

**Non-goals (5A):**
- XML FatturaPA (5B), PDF (5C), import XML (5D).
- Note di Credito / **TD04** / stato `stornata` e `nc-sync` (5B). Le colonne `fattura_originale_id`, `nc_ids`, `tipo_storno`, `nc_totale_importo` restano **dormienti** (default già a schema).
- "Un-send" (revert inviata→bozza): fuori scope per proteggere la numerazione gap-free.
- Regime ordinario / IVA: 5A assume forfettario (no IVA in riga). Il regime arriva da `year_settings` per i validatori.

---

## 2. Architettura & file layout

```
drizzle/
  <nuova migration>                 # progressivo + numero_display → nullable
src/server/db/
  schema.ts (modifico)              # fatture.progressivo / .numeroDisplay nullable
src/shared/
  fattura-logic.ts (+ .test.ts)     # puro: computeImporto, isBolloDovuto, validateRitenuta/Cliente
  schemas.ts  (estendo)             # RigaSchema, FatturaCreateInput/UpdateInput, FatturaPublic, StatoFatturaEnum
  types.ts    (estendo)             # tipi derivati (Fattura, Riga, StatoFattura)
src/server/
  routes/fatture.ts (+ .test.ts)    # CRUD + transition endpoints (invia/paga/bozza)
  index.ts                          # mount app.route('/api/fatture', fattureRoute)
src/client/
  lib/fatture-api.ts                # client tipizzato (list/get/create/update/remove/invia/paga)
  pages/fatture.ts                  # tabella + filtri + modal CRUD + segna-pagata inline + barra 85k
  components/bottom-nav.ts (estendo)# abilito voce "Fatture"
  main.ts                  (estendo)# route '/fatture'
scripts/smoke-playwright.mjs (estendo)
```

---

## 3. Schema migration (unica modifica DB)

Rendere `progressivo` (`integer`) e `numero_display` (`text`) **nullable**: le bozze non hanno numero finché non vengono inviate. L'indice esistente `uniqueIndex('fatture_progressivo_idx', profile_id, anno_progressivo, progressivo)` **resta invariato** — in SQLite ogni `NULL` è considerato distinto, quindi N bozze (progressivo NULL) coesistono mentre i numeri assegnati restano unici per anno.

- Nessun dato in produzione (pre-go-live) → il table-rebuild generato da drizzle-kit è sicuro.
- Generare con `npm run db:generate`; **mai** editare migration esistenti.

---

## 4. Logica pura condivisa — `@shared/fattura-logic.ts`

Zero DOM/DB. Riusata da refine Zod, route e test.

- `computeRigaTotale(riga)` → `quantità × prezzo_unitario`; `computeImporto(righe)` → somma. Guard su negativi / `noUncheckedIndexedAccess`.
- `isBolloDovuto(regime, imponibileEsente)` → forfettario **e** imponibile esente IVA > **77,47 €** ⇒ `true` (marca da bollo 2 € dovuta). Soglia strict.
- `validateRitenutaForfettario(regime, ritenuta)` → se `regime==='forfettario'` e `ritenuta>0` ⇒ messaggio errore (art. 1 c. 67 L. 190/2014). Port del messaggio CalcoliVari.
- `validateClienteSnapshot(snapshot)` → cliente IT senza P.IVA né CF ⇒ errore (FatturaPA §1.4.1.2). Riusa `@shared/validators` (4A).

### Zod (estensione `schemas.ts`)
- `StatoFatturaEnum = z.enum(['bozza','inviata','pagata','stornata','annullata'])` (5A usa bozza/inviata/pagata; stornata/annullata dormienti).
- `RigaSchema = { descrizione: string.min(1), quantita: number>0 (default 1), prezzoUnitario: number }`.
- `FatturaCreateInput`: `{ clienteId, tipoDocumento(default 'TD01'), data(ISO), righe: RigaSchema[].min(1), ritenuta(default 0), aliquotaRitenuta?, tipoRitenuta?, causaleRitenuta?, contributoIntegrativo(default 0), marcaDaBollo(bool default false), bolloAddebitato(bool default false), modalitaPagamento?, note? }`.
- `FatturaUpdateInput = FatturaCreateInput.partial()` (+ stesse refine cross-field, stile `applyRefines` 4A).
- `FatturaPublic`: forma serializzata (flag boolean, `righe`/`clienteSnapshot` come oggetti, `numeroDisplay`/`progressivo` nullable, `importo` computed, timestamps).

---

## 5. Route server — `routes/fatture.ts`

Pattern `pagamenti.ts` + 4A: `requireSession`, tutto scoped a `c.get('activeProfileId')`, `zJson` per envelope `400 VALIDATION`, `toPublic` per mapping.

| Metodo | Path | Effetto |
|---|---|---|
| GET | `/` | lista profilo, ordinata per data desc; filtro opzionale `?stato=` e `?anno=` |
| GET | `/:id` | dettaglio (404 se non del profilo) |
| POST | `/` | crea **bozza** (no numero); `importo` computed da righe; snapshot cliente derivato da `clienteId` |
| PATCH | `/:id` | modifica contenuto (consentito su bozza; su inviata/pagata solo campi non fiscali — vedi nota) |
| DELETE | `/:id` | **solo bozza** → altrimenti `409 FATTURA_NOT_DELETABLE` |
| POST | `/:id/invia` | transizione bozza→inviata (vedi sotto) |
| POST | `/:id/paga` | `{ date? }` inviata→pagata; deriva `pagMese`/`pagAnno` |
| POST | `/:id/annulla-pagamento` | pagata→inviata; azzera `dataPagamento`/`pagMese`/`pagAnno` |

### `POST /:id/invia` (cuore della slice) — in `db.transaction`
1. Carica fattura del profilo (404 se assente; 409 se non in `bozza`).
2. **Valida** (fail-fast): righe non vuote, `validateRitenutaForfettario`, `validateClienteSnapshot` (regime da `year_settings`).
3. **Congela** `cliente_snapshot` da `clienti` via `clienteId` (denormalizzazione al momento dell'emissione).
4. **Assegna numero**: `progressivo = (MAX(progressivo) WHERE profile, anno_progressivo) + 1`; `anno_progressivo = year(data)`; `numero_display = "YYYY/NNN"`.
5. `stato='inviata'`, `data_invio_sdi = today`.
6. Retry **una volta** su UNIQUE violation (contesa 3-utenti ≈ 0).

### `POST /:id/paga` / `POST /:id/annulla-pagamento`
Port di `markPagata`/reset da `fatture-state-machine.js`. `paga`: inviata→pagata, `pagMese=mese(date)`, `pagAnno=anno(date)`, `dataPagamento=date|today`. `annulla-pagamento`: pagata→inviata (azzera dati pagamento). In 5A **non** esiste inviata→bozza (protegge la numerazione).

**Nota PATCH su inviata/pagata:** per non introdurre incoerenze di numerazione, 5A consente PATCH di contenuto fiscale (righe/importo/ritenuta) **solo** su `bozza`. Su inviata/pagata sono modificabili solo `note`/`modalitaPagamento`. Tentativi su campi bloccati → `409 FATTURA_LOCKED`.

`toPublic`: integer 0/1 ↔ boolean, parse JSON `righe`/`cliente_snapshot`, `importo` ricalcolato/persistito coerente.

---

## 6. Frontend — `pages/fatture.ts` + `lib/fatture-api.ts`

Tabella (redesign CalcoliVari 2026-05-08): `NUM | Cliente | Emessa | Incassata | € | Stato | Azioni`.
- **Filtri chip:** Tutte / Da pagare (inviata) / Pagate / Bozze.
- **Barra fatturato** anno corrente vs **85.000 €** (progress).
- **Stati/azioni:** BOZZA → numero `—`, azioni `✉` (invia) e `×` (elimina); INVIATA → numero `YYYY/NNN`, azione `€` (segna pagata inline con `<input type=date>`); PAGATA → data incassata, nessuna azione.
- **Click riga** → `modal.ts` con form: `<select>` cliente (da `/api/clienti`, preselezione default), righe dinamiche (aggiungi/rimuovi, totale live), flag bollo/contributo, note. Submit → create/update; poi `✉` per inviare.
- Riusa `renderHeader`/`wireHeader`, `renderBottomNav` (abilito tab Fatture), `esc()` su tutti i valori utente.

`fatture-api.ts`: `listFatture`, `getFattura`, `createFattura`, `updateFattura`, `removeFattura`, `inviaFattura`, `pagaFattura(id,date?)`, `annullaPagamento(id)`. Tipi da `@shared/types`.

---

## 7. Validatori & rilievi audit pertinenti (by-design)

- **Ritenuta forfettario = vietata** (art. 1 c. 67): blocco server in `/invia` (rilievo correlato).
- **Cliente IT senza P.IVA/CF** (FatturaPA §1.4.1.2): blocco in `/invia`.
- **Bollo 77,47 €** strict: `isBolloDovuto` lato server.
- Rilievi C2 (ordinario N1/N6.x), A2 (P.IVA cedente XML fail-fast), A3 (contributo integrativo UI/XML), M2 (NC ImportoPagamento) ⇒ pertinenti a **5B/XML**, non 5A.

---

## 8. Testing

`node --test` (+ `tsx`):
- **Logica pura:** totali righe; soglia bollo 77,47 (boundary `77.47`/`77.48`); blocco ritenuta forfettario; cliente IT.
- **Route:** round-trip POST/GET/PATCH/DELETE; create = bozza senza numero.
- **Numerazione:** due `/invia` nello stesso anno → `2026/1`, `2026/2`; gap-free dopo delete di una bozza intermedia; anni diversi ripartono da 1.
- **State machine:** transizioni illegali → 409 (es. `/paga` su bozza, `/invia` su inviata); delete non-bozza → 409; PATCH fiscale su inviata → 409.
- **Scoping:** id di altro profilo → 404.
- **Smoke Playwright:** crea bozza → invia (ottiene numero) → segna pagata.

`tsc` (client + server) pulito; `npm run build` ok; suite full verde (221 esistenti + nuovi).

---

## 9. Definition of Done

- [ ] Migration nullable applicata; `db:generate` pulito.
- [ ] CRUD scoped + `importo` computed + snapshot cliente all'invio.
- [ ] Numerazione atomica gap-free per anno (transazione + retry).
- [ ] State machine bozza→inviata→pagata (+ paga→inviata); transizioni illegali 409.
- [ ] Validatori server-side (ritenuta forfettario, cliente IT, bollo 77,47).
- [ ] Pagina `/fatture`: tabella + filtri + modal CRUD + segna-pagata inline + barra 85k.
- [ ] `bottom-nav` abilita Fatture; route `/fatture`; smoke verde.
- [ ] Suite + typecheck + build verdi; data-model.md invariato (solo nullability annotata).

---

## 10. Note per l'esecutore

- Repo root `C:\Users\matti\Documents\Progetti\Lira\Lira`; shell PowerShell.
- `noUncheckedIndexedAccess`: sempre `arr[0]!` o guard.
- Nessuna nuova dependency (Hono/Drizzle/Zod/DOM già presenti).
- Niente legacy carry-over: la logica `data.fatture[m]` mensile di CalcoliVari **non** si porta (vedi data-model "Cosa NON c'è"); single source of truth = tabella `fatture`.
