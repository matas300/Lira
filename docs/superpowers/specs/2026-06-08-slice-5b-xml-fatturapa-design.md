# Slice 5B — XML FatturaPA TD01 (Design / Spec)

- **Data:** 2026-06-08
- **Stato:** approvato (brainstorm), in attesa review spec
- **Slice:** 5B (seconda sotto-slice di Fase 5 — Fatture, decomposta)
- **Predecessore:** Slice 5A (Fatture core) su `main`
- **Workflow:** brainstorm → **spec (questo doc)** → writing-plans → subagent-driven execute

---

## 1. Obiettivo & scope

Generare l'**XML FatturaPA v1.2** per il documento ordinario **TD01** a partire da una fattura *numerata* di Lira, ed esporlo via endpoint di **download on-demand**. È il deliverable legale del modulo Fatture: senza XML non si trasmette nulla al Sistema di Interscambio (SDI).

Approccio: **port della logica XML già provata e audit-hardened di CalcoliVari** (`fatture-xml-helpers.js` + il builder `buildFatturaElettronicaXml` di `fatture-docs-feature.js` + la relativa suite di test) in un modulo TypeScript **puro** in `@shared`. La verità resta server-side: l'endpoint genera, valida e scarica.

**Decisioni di scope (brainstorm 2026-06-08):**
- **Cedente:** letto dai dati di profilo esistenti (`profiles.anagrafica` + `profiles.attivita` + `year_settings.regime`), validato con schema tipizzato, **fail-fast** se incompleto (audit A2). **Nessun** editor di profilo in 5B.
- **Copertura cessionario:** IT B2B/B2C (CodiceDestinatario SDI 7 char o PEC) · **PA** (IPA 6 char) · **Estero/UE** (`XXXXXXX` + Nazione). Porta i rami già coperti da CalcoliVari.
- **Consegna:** on-demand, `GET /api/fatture/:id/xml` → download file (naming SDI `IT<piva>_<progr>.xml`). **Niente persistenza** dell'XML (riproducibile dal `cliente_snapshot` congelato) e **niente trasmissione SDI** (richiede intermediario, fuori scope).

**Non-goals (5B → slice successivi):**
- **TD04 / Note di Credito / stato `stornata` / nc-sync** (5C). Le colonne `fattura_originale_id`, `nc_ids`, `tipo_storno`, `nc_totale_importo` restano dormienti.
- **PDF** (jspdf) (5D).
- **Import XML** (nuove + legacy) (5E).
- **Trasmissione SDI** e **editor anagrafica profilo**.
- **Regime ordinario con IVA in riga:** 5B implementa la mappatura `RF01` ma il caso d'uso primario è forfettario `RF19`; l'ordinario con aliquote IVA non-zero è verificato solo se il dato c'è (il forfettario resta il path testato a fondo).

---

## 2. Architettura & file layout

Tutto server-authoritative. Nessuna modifica allo schema DB (i campi necessari esistono già da 5A).

```
src/shared/
  fattura-xml.ts (+ .test.ts)     # PURO: buildFatturaXml(input) → string
                                  #   + helpers port: sanitizeXmlLatin1, modalitaToCodiceMP,
                                  #   sanitizeProgressivoInvio, buildAnagrafica (Denom XOR Nome/Cognome),
                                  #   regimeToRF, naturaForRegime, buildDatiBollo, buildDatiRiepilogo
  cedente.ts (+ .test.ts)         # CedenteSchema (Zod) + readCedenteFromProfile(profile, yearSettings)
                                  #   → { cedente } | { errors: string[] }  (fail-fast, audit A2)
  schemas.ts / types.ts (estendo) # eventuale FatturaXmlInput / Cedente types derivati
src/server/
  routes/fatture.ts (estendo)     # nuovo handler GET /:id/xml
src/client/
  lib/fatture-api.ts (estendo)    # downloadFatturaXml(id) (fetch blob → save)
  pages/fatture.ts (estendo)      # bottone "Scarica XML" sulle fatture numerate
```

**Perché `@shared` e non `@server/lib`:** il generatore è puro (no DB/DOM) e riusa i validatori puri già in `@shared` (`validators.ts`, `fattura-logic.ts`); tenerlo in `@shared` consente, in futuro, un'eventuale anteprima client senza duplicare logica. L'endpoint resta l'unico punto di accesso autoritativo.

---

## 3. Cedente — lettura tipizzata + fail-fast (`@shared/cedente.ts`)

L'XML richiede l'anagrafica del **cedente/prestatore** (l'emittente). In Lira vive come JSON non tipizzato:
- `profiles.anagrafica` → `{ cf, nome, cognome, residenza: {indirizzo, cap, citta, provincia} }`
- `profiles.attivita` → `{ partita_iva, codice_ateco, comune_domicilio, regime_default }`
- `year_settings.regime` → `forfettario | ordinario`

`readCedenteFromProfile(profile, yearSettings)`:
1. Estrae e normalizza i campi in una struttura `Cedente` tipizzata (P.IVA, CF, denominazione/nome+cognome, sede {indirizzo, cap, comune, provincia, nazione='IT'}, regime, RF).
2. **Valida fail-fast** e ritorna `{ errors: string[] }` con l'elenco dei campi mancanti/invalidi. **Bloccanti** (audit A2):
   - **P.IVA cedente** presente e con check-digit valido (riusa `isValidPartitaIvaIT`).
   - Sede minima: indirizzo, CAP (5 cifre), comune, provincia (2 char), nazione.
   - Almeno Denominazione **oppure** Nome+Cognome.
   - Regime mappabile a RF (`forfettario`→`RF19`, `ordinario`→`RF01`).
3. Se valido ritorna `{ cedente }`.

L'endpoint NON produce mai XML con cedente incompleto: meglio un **422 leggibile** che un XML scartato da SDI.

---

## 4. Generatore XML — `@shared/fattura-xml.ts` (port)

Funzione principale **pura**: `buildFatturaXml(input: FatturaXmlInput): string` dove `FatturaXmlInput = { cedente, cessionario (da cliente_snapshot), fattura (numero_display, data, righe, importo, ritenuta, contributoIntegrativo, marcaDaBollo, modalitaPagamento), regime }`.

**Helpers portati da `fatture-xml-helpers.js`** (con i loro test):
- `sanitizeXmlLatin1` — conformità XSD `String*LatinType` (Basic Latin + Latin-1 Supplement): NFC + mappatura smart-quotes/dash/€/… → ASCII/Latin-1, strip del resto. Applicato a Denominazione/Nome/Cognome/Indirizzo/Comune/Causale/Descrizione **prima** dell'`xmlEscape`.
- `xmlEscape` — `& < > " '` (port da `HtmlUtils`).
- `modalitaToCodiceMP` — stringa libera → `MP01..MP15` (default `MP05` bonifico).
- `sanitizeProgressivoInvio` — ≤10 char alfanumerici.
- `buildAnagrafica` — `Denominazione` (PG/con P.IVA) **XOR** `Nome`+`Cognome` (PF senza P.IVA).
- `regimeToRF` — `forfettario→RF19`, `ordinario→RF01`.

**Struttura emessa (TD01 forfettario, ordine elementi conforme XSD):**
```
FatturaElettronica versione="FPR12"
  Header
    DatiTrasmissione: IdTrasmittente(IT+piva), ProgressivoInvio, FormatoTrasmissione=FPR12,
                      CodiceDestinatario (SDI7 | IPA6 | 0000000+PECDestinatario | XXXXXXX estero)
    CedentePrestatore: DatiAnagrafici(IdFiscaleIVA, [CodiceFiscale], Anagrafica, RegimeFiscale), Sede
    CessionarioCommittente: DatiAnagrafici([IdFiscaleIVA],[CodiceFiscale], Anagrafica), Sede
  Body
    DatiGenerali/DatiGeneraliDocumento: TipoDocumento=TD01, Divisa=EUR, Data, Numero, [DatiBollo]
    DatiBeniServizi:
      DettaglioLinee*: NumeroLinea, Descrizione, Quantita, PrezzoUnitario, PrezzoTotale,
                       AliquotaIVA=0.00, Natura=N2.2 (forfettario)
      DatiRiepilogo: AliquotaIVA=0.00, Natura=N2.2, ImponibileImporto, Imposta=0.00, RiferimentoNormativo
    DatiPagamento: CondizioniPagamento=TP02, DettaglioPagamento(ModalitaPagamento, ImportoPagamento)
```

**Regole fiscali by-design** (audit + CLAUDE.md):
- **Forfettario** → `Natura N2.2` (operazioni non soggette), `AliquotaIVA 0.00`, `Imposta 0.00`, `RiferimentoNormativo` regime forfettario; **nessun `DatiRitenuta`** emesso (esonero art. 1 c. 67 L. 190/2014 — già bloccato all'invio in 5A).
- **Bollo** (`marca_da_bollo=1`, dovuto se imponibile > 77,47 €): `DatiBollo` con `BolloVirtuale=SI`, `ImportoBollo=2.00`.
- **A3 — contributo integrativo:** se `contributo_integrativo > 0` (es. rivalsa cassa) emette `DatiCassaPrevidenziale` coerente con l'importo; altrimenti omesso. Coerenza UI↔XML verificata da test.
- `ProgressivoInvio` derivato dal `numero_display`/progressivo (≤10 char); `Numero = numero_display`.
- Importi formattati a 2 decimali (`fmtXmlNum`).

---

## 5. Endpoint — `GET /api/fatture/:id/xml`

Scoped al profilo via `requireSession` + `activeProfileId` (pattern 5A).
1. Carica la fattura → **404 `FATTURA_NOT_FOUND`** se assente/altro profilo.
2. **422 `FATTURA_NON_NUMERATA`** se `stato='bozza'` (nessun `Numero` → XML invalido).
3. `readCedenteFromProfile` → **422 `CEDENTE_INCOMPLETO`** con `details: string[]` (campi mancanti) se fail-fast.
4. `cessionario` dal `cliente_snapshot` congelato; selezione ramo IT/PA/Estero da `nazione`/`codiceSdi`/`pec`.
5. `buildFatturaXml(input)` → stringa.
6. Risposta: `Content-Type: application/xml`, `Content-Disposition: attachment; filename="IT<piva>_<progr>.xml"`. Naming SDI: prefisso paese + identificativo univoco alfanumerico.

Errori sempre via `HttpError` + envelope `{ error: { code, message, details? } }`. **Mai** XML invalido in uscita.

---

## 6. Frontend

`pages/fatture.ts`: sulle righe **numerate** (`stato ∈ {inviata, pagata}`) un bottone **"Scarica XML"**. `fatture-api.ts`: `downloadFatturaXml(id)` fa `fetch` del blob e triggera il salvataggio col filename dell'header; in caso di 422 mostra il messaggio (es. "Cedente incompleto: manca P.IVA…") via `alert`/inline. Nessun cambiamento di layout oltre il bottone.

---

## 7. Testing (TDD)

Port della suite XML di CalcoliVari in TS (`node --test`) + nuovi test 5B-specifici:
- **Helpers:** `sanitizeXmlLatin1` (smart-quotes/€/NFC/strip), `modalitaToCodiceMP`, `sanitizeProgressivoInvio`, `buildAnagrafica` (Denom XOR Nome/Cognome).
- **Generatore:** ordine elementi conforme XSD; `Natura N2.2` forfettario; **assenza `DatiRitenuta`** in forfettario; `DatiBollo` quando dovuto; cliente **UE/Estero** (`XXXXXXX` + Nazione); cliente **PA** (IPA 6); `ProgressivoInvio`/`Numero`; formattazione importi; **A3** contributo integrativo coerente.
- **Cedente:** fail-fast su P.IVA mancante/invalida, sede incompleta, denominazione assente.
- **Endpoint:** 404 (scoping), 422 `FATTURA_NON_NUMERATA` (bozza), 422 `CEDENTE_INCOMPLETO`, 200 con `Content-Type`/`Content-Disposition` corretti su una **fattura golden**.
- **Golden:** un XML di riferimento (forfettario, una riga, bollo) confrontato byte-a-byte come regressione.

L'intera suite (≥242 attuali + nuovi) deve restare verde; `tsc` client+server e build puliti.

---

## 8. Definition of Done

- [ ] `@shared/fattura-xml.ts` + helpers portati, test verdi (incl. element-order e natura).
- [ ] `@shared/cedente.ts` reader+validator fail-fast (audit A2), test verdi.
- [ ] `GET /api/fatture/:id/xml` scoped: 404/422/200 con header corretti; mai XML invalido.
- [ ] Copertura cessionario IT B2B/B2C + PA + Estero verificata da test.
- [ ] Regole by-design: N2.2 forfettario, no-ritenuta, bollo 2.00, A3 contributo integrativo.
- [ ] Frontend: bottone "Scarica XML" sulle fatture numerate.
- [ ] Golden XML di regressione.
- [ ] Suite intera + `tsc` client/server + build verdi.
- [ ] `docs/migration-plan.md` Fase 5: XML FatturaPA TD01 spuntato.

---

## 9. Rischi & note

- **Ordine elementi XSD:** il rischio numero uno per lo scarto SDI. Mitigazione: port 1:1 dell'ordine di CalcoliVari + test `element-order` dedicato.
- **Cedente incompleto sui profili attuali:** i profili demo/test potrebbero non avere anagrafica completa → il fail-fast lo rende esplicito (non è un bug del generatore). L'editor di profilo che colma il gap è uno slice a parte.
- **Riproducibilità senza persistenza:** l'XML dipende dal profilo (cedente) oltre che dal `cliente_snapshot`. Se l'anagrafica cedente cambia, un nuovo download differisce. Accettabile in 5B (nessuna trasmissione/archivio legale in-app); la persistenza è un'opzione futura.
- **Ordinario/IVA:** mappatura `RF01` presente ma non è il path testato a fondo; il forfettario resta il caso garantito.
