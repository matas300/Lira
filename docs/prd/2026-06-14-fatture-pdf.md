<!--
PRD awaiting publish to GitHub Issues (gh CLI not installed on this machine).
To publish: gh issue create --title "Slice 5D — PDF delle fatture" --body-file docs/prd/2026-06-14-fatture-pdf.md --label ready-for-agent
-->

# Slice 5D — PDF delle fatture

## Problem Statement

Today a user can create, send, and export a fattura as FatturaPA XML, but cannot produce a human-readable **PDF** of it. The XML is the artifact for the Sistema di Interscambio; it is not something a user can hand to a client, archive, or read. CalcoliVari (the app Lira replaces) let users preview and download a PDF of every invoice, and users expect that capability in Lira. Without it, a user has to either send the raw XML (unreadable) or recreate the document by hand.

## Solution

From every fattura row, the user can open a **PDF** of that document in a new browser tab. The PDF is generated server-side so it always tells the same fiscal story as the XML (same cedente, same importi, same **Dicitura legale**). It works for both an emitted **Documento emesso** (a fiscally-valid PDF) and a **Bozza** (a clearly watermarked, non-fiscal draft preview). Credit notes (**Nota di Credito**, TD04) get a PDF too. From the browser's PDF viewer the user can save the file with a human-friendly name.

## User Stories

1. As a forfettario freelancer, I want to open a PDF of an emitted fattura, so that I can send my client a readable document instead of raw XML.
2. As a user, I want the PDF to open in a new tab, so that I can read it immediately without managing a downloaded file.
3. As a user, I want to download the PDF from the viewer with a recognizable filename (e.g. `fattura_2025-3.pdf`), so that my archive is organized.
4. As a user, I want to preview a **Bozza** as a PDF before sending it, so that I can check how the finished document will look.
5. As a user, I want a draft PDF to carry an unmistakable "non valida ai fini fiscali" watermark, so that I never confuse a draft with a real invoice or accidentally send it to a client as final.
6. As a user, I want the PDF button to appear on every fattura row including bozze, so that preview is always one click away.
7. As a user emitting a **Nota di Credito**, I want a PDF of the credit note, so that I have a readable record of the variation I issued.
8. As a user, I want the credit-note PDF to clearly state it is a "Nota di Credito" and reference the original fattura (number and date), so that the recipient understands what is being reversed.
9. As a forfettario user, I want the mandatory **Dicitura legale** (franchigia IVA / no ritenuta, art. 1 c. 54-89 L. 190/2014) always printed on the PDF, so that my document is compliant.
10. As a user, I want my own free-text note to appear in addition to the dicitura, so that I can add context without ever dropping the mandatory legal statement.
11. As a user, I want the PDF to show the cedente (me) and the cessionario (my client) with their fiscal identifiers and addresses, so that the document identifies both parties.
12. As a user, I want the PDF to list each riga with description, quantity, unit price and line total, so that the client sees the breakdown.
13. As a user, I want the totals section to reflect the forfettario shape (no IVA column, importo totale), so that the document matches my regime.
14. As a user whose bollo is addebitato over the 77,47 € soglia, I want the €2 rimborso bollo line shown on the PDF, so that it matches the XML and the amount my client owes.
15. As a user, I want a numbered fattura with incomplete cedente data to be refused with a clear error, so that I never produce a fiscally-valid PDF with a broken header.
16. As a user previewing a bozza with missing client fields, I want the PDF to render anyway with `(dato mancante)` placeholders, so that I can still preview work in progress.
17. As a user, I want the emitted-document PDF to be gated exactly like the XML (numbered only), so that the two exports behave consistently for real documents.
18. As a user, I want the PDF to use my profile's anagrafica and the year's regime, so that the document reflects my current fiscal setup.
19. As a user of another profile, I want to be unable to open a PDF for a fattura I don't own, so that my data stays isolated.
20. As a user, I want the PDF layout to be a polished version of CalcoliVari's familiar four-section document, so that it feels like the app I'm used to but reads a little cleaner.
21. As a user, I want the PDF's fiscal facts (importo, bollo, dicitura) to be identical to the XML's, so that the two documents never disagree.

## Implementation Decisions

**Architecture (see ADR-0001):**
- PDF is generated **server-side** via a new endpoint `GET /api/fatture/:id/pdf`, mirroring the existing `GET /api/fatture/:id/xml`. Rationale: the **Dicitura legale** and regime resolution are fiscally meaningful (the NR-10 class of bug) and must stay server-authoritative so PDF and XML cannot drift.
- The PDF library is **pdfkit** (pure JS, Helvetica → no embedded fonts, streams into the Hono response). Rejected: client-side jsPDF (duplicates dicitura logic on the client), Playwright→PDF (headless Chromium too heavy for the 512MB Fly VM).

**Modules:**
- New pure module in `src/shared/` (analogous to `fattura-xml.ts`): a **view-model builder** that maps a fattura payload (`FatturaPublic` fields + resolved cedente) to a structured PDF view model — title, parti (cedente/cessionario), righe, totali, the resolved **Dicitura legale** string, the additive user note, and a `watermark` boolean. This module holds all fiscal-correctness logic and is independent of pdfkit.
- A thin pdfkit **drawing adapter** that consumes the view model and renders the four sections (intestazione+parti, tabella righe, riepilogo totali, footer legale). Kept deliberately thin.
- New route handler in `src/server/routes/fatture.ts` that resolves the cedente from the profile + year regime (reusing the same `readCedenteFromProfile` path as the XML endpoint), builds the view model, validates per state, renders, and streams the PDF.
- The forfettario **Dicitura legale** is extracted into a **single shared constant** reused by both the XML builder (`riferimentoNormativo`) and the PDF view model, so the legal substance cannot diverge.

**Behavior decisions:**
- **State gating:** a **Bozza** is allowed (unlike XML, which is numbered-only). The PDF button appears on every fattura row; the XML button stays numbered-only.
- **Watermark:** a Bozza PDF carries an explicit "BOZZA — non valida ai fini fiscali" watermark, decided server-side from `stato`, never a client flag.
- **Validation split by state:** a **Documento emesso** (numbered) is fail-fast — reuse the same checks as the XML path (cedente complete, cliente identifiable, regime forfettario). A **Bozza** is best-effort — render with `(dato mancante)` placeholders for empty cliente/righe fields and never throw, but a resolvable cedente is still required (a missing own-anagrafica is a profile-setup problem).
- **Nota di Credito (TD04):** in scope. Amounts rendered **positive** (the document type qualifies the variation, consistent with the XML). Title "Nota di Credito" + a "Riferimento: fattura N del DD/MM/YYYY" line referencing the original.
- **Delivery:** `Content-Disposition: inline` so the PDF opens in the browser's viewer in a new tab; download is available from the viewer.
- **Filename** (suggested in `Content-Disposition`): human-friendly — `fattura_<numeroDisplay>.pdf` / `nota-credito_<numeroDisplay>.pdf` with `/`→`-`; `bozza_<short-id>.pdf` for unnumbered drafts.
- **Layout:** bounded polish (scoped exception to the no-redesign principle) — same four-section structure as CalcoliVari, improved typography/spacing/table styling. No new structure, branding, or logo.

**Client:**
- A per-row **PDF** action in the fatture page (`src/client/pages/fatture.ts`), next to the existing XML button, opening the endpoint in a new tab. Visible on all rows including bozze.

**API contract:**
- `GET /api/fatture/:id/pdf` → `200 application/pdf` (inline) on success; `422` with an error envelope for a numbered document failing fail-fast validation (e.g. `CEDENTE_INCOMPLETO`); `404` for a fattura not owned by the active profile. Authenticated via the existing session middleware.

## Testing Decisions

A good test here asserts **external behavior**, not pdfkit internals or byte layout. We do not snapshot PDF bytes or assert pixel positions — those are implementation details that change with any typography tweak. We assert the **view model** (resolved strings and flags) and the **HTTP contract** (status, content-type, disposition, gating).

**Seam 1 — pure view-model builder (`src/shared/`), prior art: `fattura-xml.test.ts`.**
Unit tests on the pure builder, no DB/HTTP:
- Forfettario **Dicitura legale** is always present; a user note appears in addition, never replacing it.
- `watermark` is true for a Bozza, false for a Documento emesso.
- TD04 produces positive amounts, the "Nota di Credito" title, and the original-document reference.
- Missing cliente/righe fields on a bozza yield `(dato mancante)` placeholders (best-effort), while a numbered document surfaces a validation error.
- Totals reflect the forfettario shape; the rimborso bollo line appears when bollo is addebitato over the soglia.

**Seam 2 — route integration (`fatture.test.ts` via `app.request`), prior art: the `GET /:id/xml` tests.**
- `GET /:id/pdf` on a numbered fattura → `200`, `content-type: application/pdf`, inline disposition, human-friendly filename; body begins with `%PDF-`.
- `GET /:id/pdf` on a **bozza** → `200` (watermarked), NOT `422` — the deliberate divergence from the XML endpoint.
- Numbered fattura with incomplete cedente → `422 CEDENTE_INCOMPLETO` with details.
- TD04 nota di credito → `200` PDF.
- Fattura of another profile → `404`.

## Out of Scope

- Regime **ordinario** PDF (RF01, IVA/ritenuta): blocked the same way the XML path is, until the ordinario engine exists (Slice 2B).
- A full visual reimagining of the document (new branding, logo, restructured layout) — only bounded typographic polish is in scope.
- Bulk/zip export of multiple PDFs.
- Server-side persistence/caching of generated PDFs (regenerated on demand).
- Emailing or sending the PDF anywhere.
- `contributoIntegrativo` rendering (not supported, consistent with the XML path).

## Further Notes

- ADR-0001 (`docs/adr/0001-pdf-fattura-server-side-pdfkit.md`) records the server-side + pdfkit decision.
- Glossary terms used: **Bozza**, **Documento emesso**, **Nota di Credito**, **Dicitura legale** (`CONTEXT.md`).
- Two verification items to resolve early during implementation: (1) confirm pdfkit installs and streams cleanly in the Docker image given esbuild's `--packages=external`; (2) confirm the fattura `note` field has no other consumer that would conflict with showing it under the dicitura.
- The no-redesign exception for the PDF document layout is recorded in project memory (2026-06-14).
