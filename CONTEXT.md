# Lira

Domain language for Lira, the fullstack app for Italian Partita IVA invoicing and tax. This glossary pins the canonical term for each concept so code, UI, and documents stay consistent.

## Documenti

**Bozza**:
A fattura that has not been emitted yet — it has no progressive number, its fiscal fields are still editable, and it is **not valid for tax purposes**. Its PDF carries an explicit watermark so it can never be mistaken for an emitted invoice; it is excluded from XML export (a draft cannot be sent to SdI).
_Avoid_: draft, provvisoria.

**Documento emesso**:
A fattura that has been numbered (`numeroDisplay` assigned, stato `inviata` / `pagata` / `stornata`). Its fiscal fields are immutable. It can be exported as XML (FatturaPA) and as a fiscally-valid PDF.
_Avoid_: fattura definitiva, documento finale.

**Nota di Credito**:
A variation document (`TipoDocumento` TD04) that reverses an emitted fattura in whole or in part. Amounts are always rendered **positive** in both XML and PDF — the document type, not the sign, qualifies the variation — and the document references the original fattura it reverses.
_Avoid_: nota di accredito; "NC" in prose (the abbreviation is fine in code).

## Conformità documentale

**Dicitura legale**:
The legally-required statement printed on a forfettario document declaring the operation is outside IVA and without ritenuta (art. 1 c. 54-89 L. 190/2014). It is **mandatory** and always present on the PDF of a forfettario document; a user's free-text note is shown in addition to it, never in place of it. The same legal substance is the XML's `riferimentoNormativo`, sourced from a single shared constant so PDF and XML cannot drift.
_Avoid_: nota legale, disclaimer.
