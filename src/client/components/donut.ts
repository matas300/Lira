// src/client/components/donut.ts
//
// Donut SVG della ripartizione fiscale (netto / imposta / INPS).
// Port della matematica di `CalcoliVari/app-charts.js:drawDonut`: tre archi
// proporzionali resi con `stroke-dasharray` su un cerchio ruotato di -90° (parte
// dalle ore 12), % netto al centro.
//
// Funzione PURA: riceve i tre importi, ritorna una stringa SVG+legenda. Nessun
// accesso al DOM, nessun side-effect → testabile senza browser. I colori
// arrivano dai design token (var(--color-…)) per seguire il tema attivo.

export interface DonutParts {
  netto: number;
  imposta: number;
  inps: number;
}

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Percentuale intera, come `fmtPct` di CalcoliVari (arrotondamento al %). */
function pct(frac: number): string {
  return Math.round((Number(frac) || 0) * 100) + '%';
}

/**
 * Ritorna l'HTML del donut (SVG + legenda). Valori negativi sono clampati a 0;
 * se il totale è 0 ritorna un placeholder "Nessun dato" (no divisione per zero).
 */
export function renderDonut(parts: DonutParts): string {
  const netto = Math.max(0, Number(parts.netto) || 0);
  const imposta = Math.max(0, Number(parts.imposta) || 0);
  const inps = Math.max(0, Number(parts.inps) || 0);
  const total = netto + imposta + inps;

  const cNetto = 'var(--color-primary)';
  const cImposta = 'var(--color-tertiary)';
  const cInps = 'var(--color-secondary)';

  if (total <= 0) {
    return `<div class="donut-empty">Nessun dato</div>`;
  }

  const size = 180;
  const cx = 90;
  const cy = 90;
  const r = 70;
  const sw = 28;
  const C = 2 * Math.PI * r;

  const pN = netto / total;
  const pT = imposta / total;
  const pC = inps / total;

  const arc = (offset: number, len: number, col: string): string =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"`
    + ` stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"`
    + ` transform="rotate(-90 ${cx} ${cy})" />`;

  const svg =
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="Ripartizione netto, imposta e INPS">`
    + arc(0, pN * C, cNetto)
    + arc(pN * C, pT * C, cImposta)
    + arc((pN + pT) * C, pC * C, cInps)
    + `<text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="var(--color-text)" font-size="20" font-weight="700">${pct(pN)}</text>`
    + `<text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--color-text-muted)" font-size="11">netto</text>`
    + `</svg>`;

  const legendItem = (color: string, label: string, value: number): string =>
    `<div class="donut-legend-item">`
    + `<span class="donut-legend-dot" style="background:${color}"></span>`
    + `<span class="donut-legend-label">${label}</span>`
    + `<span class="donut-legend-val" style="color:${color}">${eur(value)}</span>`
    + `</div>`;

  return `<div class="donut">${svg}`
    + `<div class="donut-legend">`
    + legendItem(cNetto, 'Netto', netto)
    + legendItem(cImposta, 'Imposta sost.', imposta)
    + legendItem(cInps, 'INPS', inps)
    + `<div class="donut-legend-item donut-legend-total">`
    + `<span class="donut-legend-dot" style="background:transparent"></span>`
    + `<span class="donut-legend-label">Totale lordo</span>`
    + `<span class="donut-legend-val">${eur(total)}</span>`
    + `</div>`
    + `</div></div>`;
}
