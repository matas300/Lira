# PDF fattura generato server-side con pdfkit

Le fatture sono renderizzate in PDF **server-side** (endpoint `GET /api/fatture/:id/pdf`, speculare a `/:id/xml`) usando **pdfkit**, non client-side con jsPDF come in CalcoliVari. La dicitura legale del PDF dipende dal regime fiscale — un errore qui è esattamente il bug NR-10 di CalcoliVari — quindi deve restare server-authoritative come l'XML, così PDF e XML non possono divergere. pdfkit è puro JS, usa Helvetica senza font embedding (footprint minimo sul VM Fly da 512MB) e la sua API imperativa rende il port del motore di disegno di CalcoliVari quasi 1:1.

## Considered options

- **Client-side jsPDF** (replica fedele del motore CalcoliVari): scartato perché ri-deriverebbe sul client la logica dicitura/regime — la stessa superficie del bug NR-10 — con rischio di drift rispetto all'XML.
- **Playwright → PDF** (riuso del devdep esistente, layout in HTML/CSS): scartato perché headless Chromium come runtime di produzione è troppo pesante per il VM da 512MB.
