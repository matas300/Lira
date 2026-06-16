// src/client/components/cumulative-chart.ts
//
// Grafico SVG cumulato maturato/versato (Tasse Accantonate).
// Funzione PURA: riceve i punti mensili e ritorna una stringa HTML/SVG.
// Nessun DOM, nessun side-effect → testabile senza browser.
//
// Colori da design token:
//   maturato → var(--color-tertiary)   (linea "dovuto")
//   versato  → var(--color-primary)    (linea "pagato")

const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

export interface ChartPoint {
  month: number;    // 1..12
  maturato: number;
  versato: number;
}

const W = 600;
const H = 220;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 36;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function fmt(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Ritorna l'HTML del grafico cumulato (SVG + legenda).
 * - 0 punti → placeholder "Nessun dato"
 * - max = 0 → assi mostrati senza NaN (scala clampata a 1)
 */
export function renderCumulativeChart(points: ChartPoint[]): string {
  if (points.length === 0) {
    return `<div class="chart-empty">Nessun dato</div>`;
  }

  const maxMaturato = Math.max(0, ...points.map((p) => p.maturato));
  const maxVersato = Math.max(0, ...points.map((p) => p.versato));
  const maxVal = Math.max(maxMaturato, maxVersato, 1); // min 1 → no division by zero

  // Month range for X axis: min and max month in the data (1..12)
  const minMonth = Math.min(...points.map((p) => p.month));
  const maxMonth = Math.max(...points.map((p) => p.month));
  const monthRange = Math.max(1, maxMonth - minMonth);

  function xCoord(month: number): number {
    return PAD_L + ((month - minMonth) / monthRange) * PLOT_W;
  }
  function yCoord(val: number): number {
    return PAD_T + PLOT_H - (val / maxVal) * PLOT_H;
  }

  function polyPoints(vals: number[]): string {
    return points
      .map((p, i) => `${xCoord(p.month).toFixed(1)},${yCoord(vals[i]!).toFixed(1)}`)
      .join(' ');
  }

  const maturatoPts = points.map((p) => p.maturato);
  const versatoPts = points.map((p) => p.versato);

  // Y axis labels (3 ticks: 0, mid, max)
  const yTicks = [0, maxVal / 2, maxVal].map((v) => ({
    v,
    y: yCoord(v),
    label: fmt(v),
  }));

  // X axis: show ticks at point months (deduplicated)
  const xTicks = points.map((p) => ({
    month: p.month,
    x: xCoord(p.month),
    label: MONTHS_SHORT[Math.max(0, Math.min(11, p.month - 1))] ?? String(p.month),
  }));

  const svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" class="cumulative-chart-svg" role="img" aria-label="Grafico cumulato maturato vs versato">
  <!-- Grid lines -->
  ${yTicks.map((t) => `<line x1="${PAD_L}" y1="${t.y.toFixed(1)}" x2="${W - PAD_R}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,.06)" stroke-width="1" />`).join('\n  ')}
  <!-- Y axis labels -->
  ${yTicks.map((t) => `<text x="${(PAD_L - 6).toFixed(0)}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="var(--color-text-muted)" font-size="10">${t.label}</text>`).join('\n  ')}
  <!-- X axis labels -->
  ${xTicks.map((t) => `<text x="${t.x.toFixed(1)}" y="${(H - 6).toFixed(0)}" text-anchor="middle" fill="var(--color-text-muted)" font-size="10">${t.label}</text>`).join('\n  ')}
  <!-- Axes -->
  <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T + PLOT_H}" stroke="rgba(255,255,255,.12)" stroke-width="1" />
  <line x1="${PAD_L}" y1="${(PAD_T + PLOT_H).toFixed(0)}" x2="${W - PAD_R}" y2="${(PAD_T + PLOT_H).toFixed(0)}" stroke="rgba(255,255,255,.12)" stroke-width="1" />
  <!-- Maturato line (--color-tertiary) -->
  <polyline points="${polyPoints(maturatoPts)}" fill="none" stroke="var(--color-tertiary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
  <!-- Versato line (--color-primary) -->
  <polyline points="${polyPoints(versatoPts)}" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
  <!-- Dots maturato -->
  ${points.map((p, i) => `<circle cx="${xCoord(p.month).toFixed(1)}" cy="${yCoord(maturatoPts[i]!).toFixed(1)}" r="3" fill="var(--color-tertiary)" />`).join('\n  ')}
  <!-- Dots versato -->
  ${points.map((p, i) => `<circle cx="${xCoord(p.month).toFixed(1)}" cy="${yCoord(versatoPts[i]!).toFixed(1)}" r="3" fill="var(--color-primary)" />`).join('\n  ')}
</svg>`;

  const legend = `<div class="chart-legend">
  <div class="chart-legend-item">
    <span class="chart-legend-dot" style="background:var(--color-tertiary)"></span>
    <span class="chart-legend-label">Maturato</span>
  </div>
  <div class="chart-legend-item">
    <span class="chart-legend-dot" style="background:var(--color-primary)"></span>
    <span class="chart-legend-label">Versato</span>
  </div>
</div>`;

  return `<div class="cumulative-chart">${svg}${legend}</div>`;
}
