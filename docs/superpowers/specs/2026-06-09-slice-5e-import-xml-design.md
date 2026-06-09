# Slice 5E — Import XML FatturaPA (Design / Spec)

- **Data:** 2026-06-09
- **Stato:** approvato (brainstorm), in attesa review spec
- **Slice:** 5E (quarta sotto-slice di Fase 5 — Fatture, decomposta)
- **Predecessore:** Slice 5C (Note di Credito TD04) su `main`
- **Workflow:** brainstorm → **spec (questo doc)** → writing-plans → subagent-driven execute

---

## 1. Obiettivo & scope

Importare **file XML FatturaPA** (v1.2, TD01/TD04) emessi dall'utente in Lira, dall'interno della pagina `/fatture` (upload di uno o più `.xml`). Ogni XML diventa una fattura in stato `inviata` (`origine='import'`) col **numero reale** del documento, con cliente auto-matchato/creato e dedup idempotente.

**Contesto:** l'import delle fatture dall'**export JSON** di CalcoliVari è già coperto da Slice 3 (`npm run import:legacy` importa `fattureEmesse[]` + legacy). 5E copre l'altro item del migration-plan: l'import da **file XML FatturaPA** veri (port di `CalcoliVari/fatture-import-xml.js`).

**Decisioni di scope (brainstorm 2026-06-09):**
- **Delivery:** UI web — bottone "Importa XML" in `/fatture` → file picker → endpoint `POST /api/fatture/import-xml` → report.
- **Stato import:** sempre `inviata` (`origine='import'`, `dataInvioSdi=data documento`), col numero/progressivo parsati dall'XML. Per le già pagate l'utente usa il bottone € esistente (no preview-pagamenti bulk in 5E).
- **Parsing:** **client (DOMParser)** estrae la struttura; il **server ri-valida (Zod)** e fa match/dedup/insert (autoritativo su ciò che salva). Niente nuove dipendenze. Il parser è client-only (5E è solo web).

**Non-goals (5E):**
- Flusso "legacy" con tabella preview e date di pagamento bulk (l'utente marca pagata con /paga).
- **nc-sync** sulle NC importate (le TD04 importate sono record storici/esterni: nessuno storno sull'originale, che potrebbe non essere in Lira).
- Allegati XML (`AllegatiNormali`), trasmissione SDI, import da export JSON (già in Slice 3).
- Nessuna modifica allo schema DB.

---

## 2. Architettura & file layout

```
src/client/
  lib/parse-fattura-xml.ts          # THIN: DOMParser → RawFattura (stringhe grezze) + delega a @shared
  lib/fatture-api.ts (estendo)      # importXmlFatture(items) → report
  pages/fatture.ts (estendo)        # bottone "Importa XML" + file input + render report
src/shared/
  import-fattura.ts (+ .test.ts)    # PURO: parseNumero, matchCliente, dedupKey, buildImportRow
  schemas.ts (estendo)              # ImportFatturaInput (Zod) + ImportReport
src/server/
  routes/fatture.ts (estendo)       # POST /import-xml: valida → match/crea cliente → dedup → insert
```

**Confine parser/logica:** `parse-fattura-xml.ts` fa SOLO il DOM-traversal (estrae i testi degli elementi FatturaPA in un `RawFattura`); ogni trasformazione con regole (numero, normalizzazioni, mapping riga) sta in `@shared/import-fattura.ts` (puro, testabile in `node:test`). Così la superficie browser-only non testabile in unit è minima.

---

## 3. Parser client — `@client/lib/parse-fattura-xml.ts`

`parseFatturaXml(xmlText: string): RawFattura` (thin):
1. `new DOMParser().parseFromString(xmlText, 'application/xml')`; se `<parsererror>` presente → throw `ImportParseError`.
2. Estrae per tag (via `querySelector`/`getElementsByTagName`, namespace-agnostic sui local-name):
   - `TipoDocumento`, `Data`, `Numero`, `ImportoTotaleDocumento`, `ImportoBollo`/`BolloVirtuale`, `ModalitaPagamento`, `DataScadenzaPagamento`.
   - `CessionarioCommittente`: `Denominazione`|`Nome`+`Cognome`, `IdFiscaleIVA`(`IdPaese`+`IdCodice`), `CodiceFiscale`, `Sede`(`Indirizzo`,`CAP`,`Comune`,`Provincia`,`Nazione`).
   - `DettaglioLinee[]`: `Descrizione`, `Quantita`, `PrezzoUnitario`.
3. Ritorna `RawFattura` (tutti string|null grezzi). NESSUNA logica di numero/normalizzazione qui.

`buildImportItem(raw: RawFattura): ImportFatturaInput` (in `@shared`, chiamata dal client dopo il parse): applica `parseNumero`, normalizza importi/quantità, costruisce `clienteSnapshot` e `righe`, deriva `annoProgressivo`/`progressivo`/`numeroDisplay`, `marcaDaBollo`.

> Il client chiama `parseFatturaXml` (browser) poi `buildImportItem` (@shared puro) e invia gli `ImportFatturaInput[]` all'endpoint.

---

## 4. Logica pura — `@shared/import-fattura.ts` (port)

Port da `CalcoliVari/fatture-import-xml.js`:

- **`parseNumero(numero: string, data: string): { annoProgressivo, progressivo, numeroDisplay }`** — supporta `'3/2026'` (progressivo/anno), `'2026/3'` (anno/progressivo) e `'42'` puro (anno dedotto da `data`). Disambigua il lato anno (4 cifre / coincide con `year(data)`) dal progressivo. `numeroDisplay` normalizzato a `${anno}/${progressivo}`; per numero non parsabile `progressivo=0` e `numeroDisplay=numero` raw.
- **`matchCliente(snapshot, clienti): string | null`** — albero: (1) P.IVA normalizzata → id esistente; (2) CF normalizzato (se P.IVA vuota) → id; (3) `idPaese+idCodice` (estero) → id; (4) miss → `null` (crea nuovo). P.IVA vince anche se denominazione diverge.
- **`dedupKey(item): string`** = `${tipoDocumento}|${annoProgressivo}|${progressivo}|${numero}` (TD04 distinto da TD01).
- **`buildImportItem(raw)`** — vedi §3.

`ImportFatturaInput` (Zod, §6) è la forma serializzata che l'endpoint accetta e ri-valida.

---

## 5. Endpoint — `POST /api/fatture/import-xml`

Scoped al profilo. Body: `{ items: ImportFatturaInput[] }` (max ragionevole, es. 200). Carica una volta i clienti e le fatture esistenti del profilo per match/dedup.

Per ogni item (validato da Zod via `zJson`):
1. **dedup**: se `dedupKey(item)` è già tra le fatture esistenti del profilo → `skipped: { numero, motivo: 'duplicato' }`.
2. **collisione numerazione**: se esiste già una fattura con stesso `(annoProgressivo, progressivo)` ma `dedupKey` diverso → `skipped: { numero, motivo: 'progressivo già in uso' }` (non sovrascrive, non rinumera).
3. **cliente**: `matchCliente(item.clienteSnapshot, clienti)` → se match, `clienteId=esistente`; se miss, crea un nuovo cliente dallo snapshot (dedup intra-batch per P.IVA/CF: N item stesso cliente = 1 creazione). Se la creazione fallisce la validazione → `clienteId=null` (la fattura entra comunque con lo snapshot congelato).
4. **insert** fattura: `tipoDocumento`, `annoProgressivo`, `progressivo`, `numeroDisplay`, `data`, `clienteId`, `clienteSnapshot` (JSON), `righe` (JSON), `importo`, `stato='inviata'`, `dataInvioSdi=data`, `origine='import'`, `marcaDaBollo`, `modalitaPagamento`. **No** chiamata a `/invia` (numero reale preservato). **No** nc-sync per le TD04.

Risposta `ImportReport`: `{ importate: number, clientiCreati: number, saltate: Array<{ numero, motivo }> }`. HTTP 200 anche con saltate (import parziale è normale); 400 VALIDATION solo se il body è strutturalmente invalido.

**Atomicità:** ogni insert (con eventuale create cliente) in una `db.transaction` per coerenza; il batch procede item-per-item (i validi entrano, gli errati finiscono nel report) — un import parziale è il comportamento atteso.

---

## 6. Schemi

`ImportFatturaInput` (Zod, `@shared/schemas.ts`):
```
tipoDocumento: 'TD01'|'TD04'
numero: string                 # raw, per dedupKey
data: ISO YYYY-MM-DD
annoProgressivo: number
progressivo: number
numeroDisplay: string
righe: RigaSchema[]            # riusa RigaSchema (5A)
importo: number
marcaDaBollo: boolean
modalitaPagamento: string|null
clienteSnapshot: { nome, tipoCliente, partitaIva, codiceFiscale, codiceSdi, pec,
                   indirizzo, cap, citta, provincia, nazione }   # nullable interni
```
`ImportReport` (per il tipo client): `{ importate, clientiCreati, saltate: {numero,motivo}[] }`.

---

## 7. Frontend

`pages/fatture.ts`: bottone **"Importa XML"** accanto a "Nuova". Apre un `<input type="file" accept=".xml" multiple>`; alla selezione legge i file (`file.text()`), per ciascuno `parseFatturaXml` + `buildImportItem` (gli errori di parse finiscono in un report locale), poi `importXmlFatture(items)`. Mostra un report (modal o banner): "N importate, M clienti creati, K saltate (con motivi)". `refresh()` della lista. `fatture-api.ts`: `importXmlFatture(items) → ImportReport`.

---

## 8. Testing (TDD)

- **Puro `@shared/import-fattura.ts`** (port dei test CalcoliVari): `parseNumero` (formati `3/2026`, `2026/3`, `42` puro, non-parsabile), `matchCliente` (P.IVA/CF/estero/miss + dedup), `dedupKey` (TD01 vs TD04), `buildImportItem` (raw→item, fallback righe, bollo).
- **Endpoint** `POST /import-xml`: match cliente esistente; crea cliente nuovo (+ dedup intra-batch); dedup skip su re-import; collisione progressivo → saltata; TD04 importata senza storno; report corretto; scoping profilo.
- **Parser DOM** (`parse-fattura-xml.ts`): non testabile in `node:test` (no `DOMParser`); coperto dallo **smoke Playwright** (upload di un XML reale → fattura in lista) + verifica manuale. Si tiene il thin parser minimale proprio per ridurre questa superficie.
- Suite intera (≥292) + tsc client/server + build verdi.

---

## 9. Definition of Done

- [ ] `@shared/import-fattura.ts` (parseNumero, matchCliente, dedupKey, buildImportItem) con test verdi.
- [ ] `ImportFatturaInput` Zod + tipo `ImportReport`.
- [ ] `@client/lib/parse-fattura-xml.ts` (thin DOMParser → RawFattura).
- [ ] `POST /api/fatture/import-xml` scoped: match/crea cliente, dedup, collisione, TD04, report; insert `inviata` `origine='import'`.
- [ ] Frontend: bottone "Importa XML" + file picker + report.
- [ ] Smoke Playwright: upload XML → fattura importata in lista.
- [ ] Suite + tsc client/server + build verdi.
- [ ] `docs/migration-plan.md` Fase 5: Import XML spuntato.

---

## 10. Rischi & note

- **Parser non testabile in unit:** `DOMParser` è browser-only. Mitigazione: parser thin (solo DOM-traversal) + tutta la logica in `@shared` testata; copertura E2E via smoke.
- **Collisione progressivo:** se l'utente ha già fatture manuali nello stesso `(anno, progressivo)`, l'import salta con motivo (non sovrascrive, non rinumera). Per i 3 utenti il caso è raro (o si importa o si crea a mano).
- **Numero non standard** (`'FT-001'`): `parseNumero` → `progressivo=0`, `numeroDisplay=numero` raw. Più item con `progressivo=0` nello stesso anno collidono sull'indice UNIQUE → dal secondo in poi "saltata: progressivo già in uso". Accettabile (numeri non conformi sono casi limite); l'utente li gestisce a mano.
- **Cliente creato da snapshot:** se i dati XML non passano la validazione `ClienteCreateInput` (es. SDI/PEC), il cliente non viene creato (`clienteId=null`) ma la fattura entra con lo snapshot congelato. Audit trail preservato.
- **TD04 importate:** record `origine='import'` senza `fatturaOriginaleId` necessariamente valorizzato e senza nc-sync; sono storiche/esterne. Lo storno automatico è riservato alle NC create in-app (5C).
- **Segno importi:** lo snapshot e `importo` restano positivi (come 5C); il segno TD04 è solo nell'XML in uscita (5C), non rilevante per l'import (che memorizza).
