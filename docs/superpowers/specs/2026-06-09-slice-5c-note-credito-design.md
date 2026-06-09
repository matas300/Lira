# Slice 5C — Note di Credito TD04 (Design / Spec)

- **Data:** 2026-06-09
- **Stato:** approvato (brainstorm), in attesa review spec
- **Slice:** 5C (terza sotto-slice di Fase 5 — Fatture, decomposta)
- **Predecessore:** Slice 5B (XML FatturaPA TD01) su `main`
- **Workflow:** brainstorm → **spec (questo doc)** → writing-plans → subagent-driven execute

---

## 1. Obiettivo & scope

Note di Credito **TD04** end-to-end: creazione di una NC legata a una fattura emessa, sincronizzazione storno (parziale/totale) sulla fattura originale, state machine (originale → `stornata` a storno totale), e generazione **XML FatturaPA TD04** (importi negativi + `DatiFattureCollegate`). La NC è subito inviabile a SdI.

Approccio: **una NC è una fattura** con `tipoDocumento='TD04'`. Riusa la tabella `fatture`, la route `/api/fatture`, la numerazione atomica di 5A e il generatore XML di 5B. Aggiunge la logica pura `@shared/nc-sync.ts` (port audit-hardened di `CalcoliVari/fatture-nc-sync.js`) ed estende `buildFatturaXml` con il ramo TD04.

**Decisioni di scope (brainstorm 2026-06-09):**
- **Storno parziale + totale:** una NC può stornare l'intera fattura (→ `stornata`) o una parte (accumula `ncTotaleImporto`, originale resta `inviata/pagata`); più NC parziali fino al totale. Tolleranza 0,01 € per la promozione a "totale".
- **nc-sync all'invio della NC** (non alla creazione): il side-effect sull'originale avviene quando la NC passa a `inviata`, dentro la stessa transazione della numerazione. Coerente con CalcoliVari (i 3 call-site sono tutti "mark inviata").
- **Niente reversal di NC inviata** in 5C (mirror del no-un-send di 5A): una NC inviata è definitiva.

**Non-goals (5C → slice successivi):**
- **PDF** (jspdf) (5D). **Import XML** (nuove + legacy) (5E). **Trasmissione SDI** ed **editor anagrafica profilo**.
- Reversal/annullamento di una NC già inviata; modifica fiscale di una NC inviata (solo note/modalità, come 5A).
- Nessuna modifica allo schema DB: i campi `fattura_originale_id`, `tipo_storno`, `nc_totale_importo`, `nc_ids` esistono già da 5A (dormienti).

---

## 2. Architettura & file layout

Tutto server-authoritative. Nessuna migration.

```
src/shared/
  nc-sync.ts (+ .test.ts)         # PURO: computeStorno(...) + isNCDateValid. Idempotente, tolleranza 0,01.
  schemas.ts (estendo)            # NotaCreditoCreateInput (fatturaOriginaleId, righe, data, note)
  fattura-xml.ts (estendo)        # buildFatturaXml: ramo TD04 (sign=-1, DatiFattureCollegate); FatturaXmlInput += tipoDocumento, fatturaOriginale
  __fixtures__/nota-credito-golden.xml  # golden TD04 di regressione
src/server/
  routes/fatture.ts (estendo)     # POST /:id/nota-credito (crea NC bozza); /invia esteso (nc-sync se TD04); GET /:id/xml carica originale per TD04
src/client/
  lib/fatture-api.ts (estendo)    # createNotaCredito(fatturaId, input)
  pages/fatture.ts (estendo)      # bottone "Crea NC" su inviata/pagata; modal NC (prefill righe originale); badge STORNATA / ncTotaleImporto; riga TD04 marcata
```

---

## 3. Logica pura — `@shared/nc-sync.ts` (port)

Port di `CalcoliVari/fatture-nc-sync.js`, adattato a funzione **pura** (niente mutazione di array; ritorna i valori da persistere).

```
computeStorno(args: {
  originaleImporto: number;        // somma righe originale
  originaleStato: string;          // 'inviata' | 'pagata' | 'stornata' | ...
  originaleNcIds: string[];        // ncIds correnti dell'originale
  originaleNcTotaleImporto: number;
  ncId: string;
  ncImporto: number;               // somma righe NC (valore assoluto)
}): { applied, tipoStorno: 'parziale'|'totale', ncIds, ncTotaleImporto, stato }
```

Regole (identiche a CalcoliVari):
- **Idempotente:** se `ncId` è già in `originaleNcIds` → `applied=false`, nessun incremento; ritorna i valori invariati + il `tipoStorno` ricomputato.
- Altrimenti: `ncIds = [...originaleNcIds, ncId]`, `ncTotaleImporto = round2(originaleNcTotaleImporto + ncImporto)`.
- `tipoStorno`: se `originaleImporto <= 0` → `'parziale'` (edge D-M2, no `stornata`); altrimenti `'totale'` se `ncTotaleImporto + 0.01 >= originaleImporto`, sennò `'parziale'`.
- `stato`: `'stornata'` se `tipoStorno==='totale'` (e non già stornata); altrimenti invariato.

`isNCDateValid(dataNC, dataOriginale)`: `true` se una delle due manca, altrimenti `dataNC >= dataOriginale` (confronto stringhe ISO, audit R6).

---

## 4. Creazione NC — `POST /api/fatture/:id/nota-credito`

Scoped al profilo. `:id` = fattura originale, che dev'essere **numerata** (`inviata`/`pagata`); altrimenti **409 `NC_ORIGINALE_NON_NUMERATA`**. Originale già `stornata` → **409 `NC_ORIGINALE_STORNATA`**.

Body (`NotaCreditoCreateInput`): `righe` (≥1; prefill lato client dalle righe originali, editabili per parziale), `data` (ISO; default oggi), `note?`. Validazione `isNCDateValid(data, originale.data)` → **422 `NC_DATA_ANTERIORE`**.

Crea una nuova riga `fatture`:
- `tipoDocumento='TD04'`, `fatturaOriginaleId=:id`, `origine='manuale'`.
- `clienteId` e `clienteSnapshot` **copiati dall'originale** (stesso cessionario; lo snapshot è già congelato).
- `stato='bozza'`, `progressivo/numeroDisplay=null`, `importo=computeImporto(righe)`, `annoProgressivo=year(data)`.

Ritorna la NC via `toPublic`.

---

## 5. Invio NC — estensione di `POST /:id/invia`

`/invia` (5A) assegna il numero nella sequenza condivisa e porta a `inviata`. **Estensione:** dopo l'assegnazione del numero, se `tipoDocumento==='TD04'`, applica il side-effect storno **nella stessa transazione**:
1. Carica l'originale (`fatturaOriginaleId`), scoped al profilo.
2. `computeStorno(originale, nc)`.
3. `UPDATE` originale: `nc_ids`, `nc_totale_importo`, `stato` (→ `stornata` se totale).
4. `UPDATE` NC: `tipo_storno`.

Idempotenza garantita da `computeStorno` (via `ncIds`): un retry non raddoppia. Se l'originale non esiste più (FK `set null`), la NC si invia comunque (lo storno non si applica). La numerazione resta atomica come in 5A; l'estensione TD04 si innesta nel ramo di successo.

---

## 6. XML TD04 — estensione di `buildFatturaXml`

`FatturaXmlInput` aggiunge `tipoDocumento: 'TD01'|'TD04'` e, per TD04, `fatturaOriginale: { numero: string; data: string }`.

`buildFatturaXml`:
- `tipoDoc = input.tipoDocumento`; `sign = tipoDoc==='TD04' ? -1 : 1`.
- Importi delle righe, `ImponibileImporto`, `ImportoTotaleDocumento`, `ImportoPagamento` moltiplicati per `sign` (negativi per la NC).
- **`DatiFattureCollegate`** (dentro `DatiGenerali`, dopo `DatiGeneraliDocumento`): `RiferimentoNumeroLinea=1`, `IdDocumento=fatturaOriginale.numero`, `Data=fatturaOriginale.data`. La Data dev'essere ISO `YYYY-MM-DD` (XSD xs:date, audit C8) → altrimenti errore.
- Natura N2.2 forfettario invariata; `DatiBollo` non emesso su NC (mirror CalcoliVari: il rimborso bollo è solo TD01).

`GET /:id/xml`: per una fattura TD04 carica l'originale (`fatturaOriginaleId`) per ricavare `numero`/`data` e li passa come `fatturaOriginale`. Se l'originale è assente → **422 `NC_ORIGINALE_MANCANTE`** (DatiFattureCollegate obbligatorio).

---

## 7. Frontend

`pages/fatture.ts`:
- Bottone **"Crea NC"** sulle fatture `inviata`/`pagata` non ancora `stornata`. Apre un modal prefillato con le righe dell'originale (storno totale di default), editabili per ridurre l'importo (parziale).
- Le righe NC nella lista sono marcate **TD04** (es. prefisso "NC") e mostrano un riferimento all'originale.
- Sull'originale: badge **STORNATA** quando totalmente stornata; indicatore `ncTotaleImporto` (es. "stornato €X") quando parzialmente.
- `fatture-api.ts`: `createNotaCredito(fatturaId, input)`.

---

## 8. Testing (TDD)

- **nc-sync puro** (port dei test CalcoliVari): parziale (100 su 500), totale, due parziali → totale, idempotenza, tolleranza 0,01 (999,99→totale, 999,98→parziale), edge origImp≤0 → parziale, arrotondamento; `isNCDateValid`.
- **Crea NC**: 409 su bozza/stornata, 422 `NC_DATA_ANTERIORE`, 200 con snapshot/cliente copiati dall'originale.
- **Invia NC**: applica storno (parziale: originale resta inviata, `ncTotaleImporto` aggiornato; totale: originale `stornata`, NC `tipoStorno='totale'`); idempotenza su doppio invio (bloccato comunque da 5A) e su retry.
- **XML TD04**: importi negativi, `DatiFattureCollegate` con numero/data originale, ordine elementi, **golden TD04** byte-a-byte; 422 se originale mancante.
- **UI smoke**: crea NC da una fattura inviata → invia → originale stornata.
- Suite intera (≥270) + tsc client/server + build verdi.

---

## 9. Definition of Done

- [ ] `@shared/nc-sync.ts` (computeStorno + isNCDateValid) con test port CalcoliVari verdi.
- [ ] `NotaCreditoCreateInput` Zod.
- [ ] `POST /:id/nota-credito` scoped: 409/422/200, snapshot copiato.
- [ ] `/invia` esteso: nc-sync atomico per TD04 (parziale/totale/idempotente).
- [ ] `buildFatturaXml` ramo TD04 (sign=-1, DatiFattureCollegate) + golden TD04.
- [ ] `GET /:id/xml` per TD04 carica originale; 422 se mancante.
- [ ] Frontend: "Crea NC" + modal + badge STORNATA/ncTotaleImporto.
- [ ] Suite + tsc client/server + build verdi.
- [ ] `docs/migration-plan.md` Fase 5: NC TD04 + XML TD04 spuntati.

---

## 10. Rischi & note

- **Atomicità nc-sync:** il side-effect storno tocca 2 righe (originale + NC). Va nella stessa transazione dell'invio; l'idempotenza (`ncIds`) protegge da retry. Su connessione condivisa (test), usare un singolo `db.transaction`.
- **Ordine elementi TD04:** `DatiFattureCollegate` va dentro `DatiGenerali` DOPO `DatiGeneraliDocumento` (XSD). Il golden TD04 lo blinda.
- **Originale cancellato:** FK `set null` su `fattura_originale_id`. Invio NC: lo storno non si applica (originale assente). XML: 422 `NC_ORIGINALE_MANCANTE` (DatiFattureCollegate non producibile).
- **Numerazione condivisa:** NC e fatture condividono la sequenza `(profilo, anno, progressivo)` — registro unico, conforme. Già garantito dalla tabella condivisa di 5A.
- **Segno importi:** in 5C il segno negativo è solo nell'XML TD04; in DB la NC memorizza `importo` positivo (somma righe), lo storno usa il valore assoluto. Coerente con `computeStorno` (usa `Math.abs`).
