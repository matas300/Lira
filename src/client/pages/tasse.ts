// src/client/pages/tasse.ts
//
// Pagina "Tasse Accantonate" (/tasse): confronto tra quanto andrebbe
// accantonato (incassato × % effettiva) e quanto già versato.
//
// Funzioni di render PURE (testabili senza DOM). `mount()` fa 3 fetch
// parallele e compone.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { computeAccantonamento } from '../lib/accantonamento';
import { renderCumulativeChart } from '../components/cumulative-chart';
import type { AccRow, AccDeferred, AccResult } from '../lib/accantonamento';
import type { ScenarioResponse } from './regime';

// ── Local helpers (copiati da regime.ts per indipendenza) ──────────────────

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function monthLabel(m: number): string {
  return MONTHS_SHORT[Math.max(0, Math.min(11, m - 1))] ?? String(m);
}

// ── Funzioni di render pure ────────────────────────────────────────────────

/**
 * Status box: maturato / versato / gap.
 * gap ≤ 0 → ok (in pari); gap > 0 → warn (da versare).
 */
export function renderStatus(totals: { lordo: number; daAccantonare: number; versato: number; gap: number }): string {
  const ok = totals.gap <= 0;
  const cls = ok ? 'tasse-status tasse-status-ok' : 'tasse-status tasse-status-warn';
  const gapLabel = ok
    ? `<span class="tasse-status-ok-label">In pari ✓</span>`
    : `<span class="tasse-status-warn-label">Da versare: <strong>${esc(eur(totals.gap))}</strong></span>`;
  return `<div class="${cls}">
    <div class="tasse-status-row">
      <span class="tasse-status-cell">
        <span class="tasse-status-label">Imponibile incassato</span>
        <span class="tasse-status-val">${esc(eur(totals.lordo))}</span>
      </span>
      <span class="tasse-status-cell">
        <span class="tasse-status-label">Maturato (da accantonare)</span>
        <span class="tasse-status-val">${esc(eur(totals.daAccantonare))}</span>
      </span>
      <span class="tasse-status-cell">
        <span class="tasse-status-label">Versato</span>
        <span class="tasse-status-val">${esc(eur(totals.versato))}</span>
      </span>
    </div>
    <div class="tasse-status-gap">${gapLabel}</div>
  </div>`;
}

/**
 * Tabella per-fattura incassata nell'anno + footer totali.
 */
export function renderTable(rows: AccRow[], totals: { lordo: number; daAccantonare: number; versato: number; gap: number }): string {
  if (rows.length === 0) {
    return `<div class="card tasse-panel">
      <h3>Fatture incassate nell'anno</h3>
      <p class="tasse-note">Nessuna fattura incassata nell'anno selezionato.</p>
    </div>`;
  }
  const rowsHtml = rows.map((r) => `
    <div class="tasse-table-row">
      <span class="tasse-table-mese">${esc(monthLabel(r.mese))}</span>
      <span class="tasse-table-label">${esc(r.label)}</span>
      <span class="tasse-table-lordo">${esc(eur(r.lordo))}</span>
      <span class="tasse-table-acc">${esc(eur(r.daAccantonare))}</span>
    </div>`).join('');
  return `<div class="card tasse-panel">
    <h3>Fatture incassate nell'anno</h3>
    <div class="tasse-table">
      <div class="tasse-table-header">
        <span>Mese</span><span>Fattura / Cliente</span><span style="text-align:right">Imponibile</span><span style="text-align:right">Da accantonare</span>
      </div>
      ${rowsHtml}
      <div class="tasse-table-footer">
        <span></span>
        <span>Totale</span>
        <span style="text-align:right">${esc(eur(totals.lordo))}</span>
        <span style="text-align:right">${esc(eur(totals.daAccantonare))}</span>
      </div>
    </div>
  </div>`;
}

/**
 * Tabella fatture differite (emesse nell'anno ma non ancora incassate).
 */
export function renderDeferred(deferred: AccDeferred[]): string {
  if (deferred.length === 0) {
    return `<div class="card tasse-panel">
      <h3>Fatture differite (emesse, non incassate)</h3>
      <p class="tasse-note">Nessuna fattura differita per l'anno selezionato.</p>
    </div>`;
  }
  const rowsHtml = deferred.map((d) => {
    const annoLabel = d.annoIncasso != null ? String(d.annoIncasso) : 'Non ancora incassata';
    return `<div class="tasse-table-row">
      <span class="tasse-table-label">${esc(d.label)}</span>
      <span class="tasse-table-lordo">${esc(eur(d.importo))}</span>
      <span class="tasse-table-anno">${esc(annoLabel)}</span>
    </div>`;
  }).join('');
  return `<div class="card tasse-panel">
    <h3>Fatture differite (emesse, non incassate)</h3>
    <div class="tasse-table tasse-table-deferred">
      <div class="tasse-table-header">
        <span>Fattura / Cliente</span><span style="text-align:right">Importo</span><span>Anno incasso</span>
      </div>
      ${rowsHtml}
    </div>
    <p class="tasse-note">Queste fatture non sono ancora state incassate nell'anno selezionato. Saranno tassate nell'anno di incasso effettivo.</p>
  </div>`;
}

/**
 * CTA needsConfig — come in regime.ts.
 */
export function renderNeedsConfig(year: number): string {
  return `<div class="card tasse-needsconfig">
    <h2>Tasse Accantonate ${esc(year)}</h2>
    <p class="tasse-note">Non ci sono ancora impostazioni fiscali per il ${esc(year)}: configura il regime per calcolare la percentuale effettiva da accantonare.</p>
    <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
  </div>`;
}

/**
 * Composizione completa: status + grafico + tabella + differite.
 */
export function renderTasse(result: AccResult, chartSvg: string): string {
  return `
    <div class="tasse-head">
      <h2>Tasse Accantonate</h2>
    </div>
    ${renderStatus(result.totals)}
    <div class="card tasse-panel tasse-chart-panel">
      <h3>Andamento cumulato</h3>
      ${chartSvg}
    </div>
    ${renderTable(result.rows, result.totals)}
    ${renderDeferred(result.deferred)}`;
}

// ── Tipo per le fatture dall'API ───────────────────────────────────────────

interface FatturaApi {
  importo: number;
  ritenuta?: number | null;
  data: string;
  annoProgressivo?: number | null;
  pagAnno?: number | null;
  pagMese?: number | null;
  clienteSnapshot?: unknown;  // JSON string o già parsato
  numeroDisplay?: string | null;
}

interface PagamentoApi {
  data: string;
  importo: number;
  tipo?: string | null;
}

// ── mount ──────────────────────────────────────────────────────────────────

function renderError(message: string): string {
  return `<div class="card tasse-panel">
    <h2>Tasse Accantonate</h2>
    <p class="tasse-note tasse-note-warn">${esc(message)}</p>
  </div>`;
}

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/tasse',
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card tasse-panel"><p class="tasse-note">Carico i dati…</p></div>`;
      try {
        // 3 fetch parallele
        const [scenarioData, fattureData, pagamentiData] = await Promise.all([
          api.get<ScenarioResponse>(`/api/tax/scenario?year=${year}`),
          api.get<FatturaApi[]>('/api/fatture'),
          api.get<PagamentoApi[]>(`/api/pagamenti?year=${year}`),
        ]);

        // needsConfig → CTA
        if (scenarioData.needsConfig || !scenarioData.comparison) {
          main.innerHTML = renderNeedsConfig(scenarioData.year ?? year);
          return;
        }

        const selected = scenarioData.comparison.selected;
        const gross = scenarioData.grossCollected ?? selected.grossCollected;
        const imposta = selected.substituteTax;
        const inps = selected.deductibleContributionsPaid;
        const effectiveRate = gross > 0 ? (imposta + inps) / gross : 0;

        // Normalizza clienteSnapshot: può arrivare come stringa o già come oggetto
        const fatture = (Array.isArray(fattureData) ? fattureData : []).map((f) => {
          let snap: string | null = null;
          if (typeof f.clienteSnapshot === 'string') {
            snap = f.clienteSnapshot;
          } else if (f.clienteSnapshot !== null && f.clienteSnapshot !== undefined) {
            try { snap = JSON.stringify(f.clienteSnapshot); } catch { snap = null; }
          }
          return {
            importo: f.importo,
            ritenuta: f.ritenuta,
            data: f.data,
            annoProgressivo: f.annoProgressivo,
            pagAnno: f.pagAnno,
            pagMese: f.pagMese,
            clienteSnapshot: snap,
            numeroDisplay: f.numeroDisplay,
          };
        });

        const pagamenti = (Array.isArray(pagamentiData) ? pagamentiData : []).map((p) => ({
          data: p.data,
          importo: p.importo,
          tipo: p.tipo,
        }));

        const result = computeAccantonamento({ fatture, pagamenti, year, effectiveRate });
        const chartSvg = renderCumulativeChart(result.cumulative);
        main.innerHTML = renderTasse(result, chartSvg);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare i dati. Riprova.';
        main.innerHTML = renderError(msg);
      }
    },
  });
}
