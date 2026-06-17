// src/client/pages/budget.ts
//
// Pagina "Budget" (/budget): alloca un netto mensile in voci di spesa.
// Render puri (testabili) + mount con stato locale e auto-save debounced.
// Port da CalcoliVari app-budget.js, adattato al modello per-anno di Lira.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import {
  monthsWithFatture, computeNettoMensile, computeAllocation, ceil2,
  type MonthLordo, type NettoMensile, type BudgetItemData, type AllocRow,
} from '../lib/budget-calc';
import type { ScenarioResponse } from './regime';

// ── helpers ──

const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(m: number): string {
  return MONTHS_SHORT[Math.max(0, Math.min(11, m - 1))] ?? String(m);
}

/** Palette segmenti distribuzione (CSS vars dei token Lira). */
const COLORS = [
  'var(--color-cal-lavoro)', 'var(--color-cal-mezzagiornata)', 'var(--color-cal-ferie)',
  'var(--color-chart-tasse, var(--color-warning))', 'var(--color-cal-donazione)',
  'var(--color-cal-malattia)', 'var(--color-success)', 'var(--color-info)',
  'var(--color-primary)', 'var(--color-error)',
];

function totaliRow(label: string, value: string, opts: { highlight?: boolean; tone?: 'positive' | 'negative' } = {}): string {
  const cls = ['summary-row'];
  if (opts.highlight) cls.push('is-highlight');
  if (opts.tone) cls.push(opts.tone === 'positive' ? 'is-positive' : 'is-negative');
  return `<div class="${cls.join(' ')}"><span class="summary-label">${esc(label)}</span>`
    + `<span class="summary-val">${esc(value)}</span></div>`;
}

// ── render puri ──

export function renderBaseSelector(args: {
  baseMonth: number | null;
  months: MonthLordo[];
  netto: NettoMensile;
}): string {
  const { baseMonth, months, netto } = args;
  const opts = months.map((m) =>
    `<option value="${esc(m.month)}"${baseMonth === m.month ? ' selected' : ''}>${esc(monthLabel(m.month))} — ${esc(eur(m.lordo))}</option>`,
  ).join('');

  const info = netto.source === 'media'
    ? `<span class="budget-base-info">Media annuale: <b class="budget-net">${esc(eur(netto.netto))}</b></span>`
    : `<span class="budget-base-info">${esc(monthLabel(netto.month ?? 0))}: ${esc(eur(netto.lordo))} lordo → <b class="budget-net">${esc(eur(netto.netto))}</b> netto <span class="budget-base-rate">(aliq. ${Math.round(netto.rate * 100)}%)</span></span>`;

  return `<div class="budget-base-selector">
    <label class="budget-base-label">Mese di riferimento:</label>
    <select id="budgetBaseMonth" class="budget-base-select">
      <option value=""${baseMonth == null ? ' selected' : ''}>Auto (ultima)</option>
      ${opts}
    </select>
    ${info}
  </div>`;
}

export function renderNettoHeader(netto: NettoMensile): string {
  const tasse = netto.lordo > 0 ? netto.lordo - netto.netto : 0;
  const tasseHtml = netto.lordo > 0
    ? `<span class="budget-head-tasse">Tasse + contributi: <b>${esc(eur(tasse))}</b></span>`
    : '';
  return `<div class="budget-head">
    <span class="budget-head-netto">Netto mensile: <b class="budget-net">${esc(eur(netto.netto))}</b></span>
    ${tasseHtml}
  </div>`;
}

export function renderVoceRow(i: number, item: BudgetItemData, alloc: AllocRow, netto: number): string {
  const isAuto = alloc.isAuto;
  const importoVal = isAuto ? '' : (alloc.val || '');
  const importoPlaceholder = isAuto ? (alloc.val ? alloc.val.toFixed(2) : '0') : '0';
  const pctVal = alloc.pct ? alloc.pct.toFixed(1) : '';
  return `<div class="budget-row" data-idx="${esc(i)}">
    <input type="text" class="budget-nome" value="${esc(item.nome)}" placeholder="es. Affitto, Cibo…" data-field="nome">
    <input type="number" class="budget-importo" value="${esc(importoVal)}" placeholder="${esc(importoPlaceholder)}" step="0.01" min="0" data-field="importo">
    <input type="number" class="budget-pct" value="${esc(pctVal)}" placeholder="%" step="0.1" min="0" max="100" data-field="pct">
    <label class="budget-auto-check"><input type="checkbox"${item.auto ? ' checked' : ''} data-field="auto"></label>
    <button class="btn-del" data-field="del" title="Rimuovi voce" aria-label="Rimuovi voce">×</button>
  </div>`;
}

export function renderTotali(totBudget: number, rimanente: number): string {
  return `<div class="budget-totali">
    ${totaliRow('Totale voci', eur(totBudget), { tone: 'negative' })}
    ${totaliRow('Rimanente', eur(rimanente), { highlight: true, tone: rimanente >= 0 ? 'positive' : 'negative' })}
  </div>`;
}

export function renderDistribuzione(rows: AllocRow[], netto: number, rimanente: number): string {
  if (netto <= 0 || rows.every((r) => r.val <= 0)) return '';
  let bar = '';
  let legend = '';
  rows.forEach((r, i) => {
    if (r.val <= 0) return;
    const w = (r.val / netto) * 100;
    const color = COLORS[i % COLORS.length]!;
    bar += `<div class="budget-bar-seg" style="width:${w}%;background:${color}${r.isAuto ? ';opacity:.6' : ''}" title="${esc(r.nome)}: ${esc(eur(r.val))}"></div>`;
    legend += `<div class="budget-legend-item">
      <span class="budget-legend-dot" style="background:${color}${r.isAuto ? ';opacity:.6' : ''}"></span>
      <span class="budget-legend-nome">${esc(r.nome || 'Voce ' + (i + 1))}${r.isAuto ? ' (auto)' : ''}</span>
      <span class="budget-legend-val">${esc(eur(r.val))}</span>
      <span class="budget-legend-pct">(${esc(r.pct.toFixed(1))}%)</span>
    </div>`;
  });
  if (rimanente > 0) {
    const w = (rimanente / netto) * 100;
    bar += `<div class="budget-bar-seg budget-bar-rem" style="width:${w}%"></div>`;
    legend += `<div class="budget-legend-item">
      <span class="budget-legend-dot budget-legend-rem"></span>
      <span class="budget-legend-nome">Rimanente</span>
      <span class="budget-legend-val">${esc(eur(rimanente))}</span>
      <span class="budget-legend-pct">(${esc((rimanente / netto * 100).toFixed(1))}%)</span>
    </div>`;
  }
  return `<div class="budget-distribuzione">
    <div class="budget-distribuzione-title">Distribuzione sul netto mensile</div>
    <div class="budget-bar">${bar}</div>
    <div class="budget-legend">${legend}</div>
  </div>`;
}

export function renderNeedsConfig(year: number): string {
  return `<div class="card budget-needsconfig">
    <h2>Budget ${esc(year)}</h2>
    <p class="budget-note">Non ci sono ancora impostazioni fiscali per il ${esc(year)}: configura il regime per calcolare il netto mensile da allocare.</p>
    <a class="btn btn-primary" href="/" data-route="/">Configura il ${esc(year)}</a>
  </div>`;
}

// ── compositore ──

interface BudgetState {
  baseMonth: number | null;
  items: BudgetItemData[];
}

function renderBudget(state: BudgetState, months: MonthLordo[], rate: number, nettoAnnuo: number): string {
  const netto = computeNettoMensile({ baseMonth: state.baseMonth, months, rate, nettoAnnuo });
  const alloc = computeAllocation(state.items, netto.netto);
  const rowsHtml = state.items.map((it, i) => renderVoceRow(i, it, alloc.rows[i]!, netto.netto)).join('');
  return `<div class="budget-page">
    <div class="budget-page-header"><h2>Budget ${esc(getYear())}</h2></div>
    ${renderBaseSelector({ baseMonth: state.baseMonth, months, netto })}
    ${renderNettoHeader(netto)}
    <div class="budget-table">
      <div class="budget-table-header"><span>Voce</span><span>Importo (€)</span><span>%</span><span>Auto</span><span></span></div>
      ${rowsHtml}
    </div>
    <button class="btn-add" id="budgetAdd">+ Aggiungi voce</button>
    ${renderTotali(alloc.totBudget, alloc.rimanente)}
    ${renderDistribuzione(alloc.rows, netto.netto, alloc.rimanente)}
  </div>`;
}

// ── mount ──

interface BudgetResponse {
  baseMonth: number | null;
  items: Array<{ id: string; year: number; nome: string; importo: number; auto: boolean; ordine: number }>;
}

interface FatturaApi {
  importo: number;
  ritenuta?: number | null;
  pagAnno?: number | null;
  pagMese?: number | null;
  stato?: string | null;
  tipoDocumento?: string | null;
}

export function mount(container: HTMLElement): () => void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let doSave: (() => void) | null = null;

  return mountPage({
    container,
    route: '/budget',
    onUnmount: () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (dirty && doSave) doSave(); // flush finale
    },
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card budget-note">Carico il budget…</div>`;

      let budget: BudgetResponse;
      let scenario: ScenarioResponse;
      let fattureRaw: FatturaApi[];
      try {
        [budget, scenario, fattureRaw] = await Promise.all([
          api.get<BudgetResponse>(`/api/budget/${year}`),
          api.get<ScenarioResponse>(`/api/tax/scenario?year=${year}`),
          api.get<FatturaApi[]>('/api/fatture'),
        ]);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare il budget. Riprova.';
        main.innerHTML = `<div class="card budget-note budget-note-warn">${esc(msg)}</div>`;
        return;
      }

      if (scenario.needsConfig || !scenario.comparison) {
        main.innerHTML = renderNeedsConfig(scenario.year ?? year);
        return;
      }

      const selected = scenario.comparison.selected;
      const gross = scenario.grossCollected ?? selected.grossCollected;
      const rate = gross > 0 ? (selected.substituteTax + selected.deductibleContributionsPaid) / gross : 0;
      const nettoAnnuo = scenario.nettoAnnuo ?? (gross - selected.substituteTax - selected.deductibleContributionsPaid);
      const months = monthsWithFatture(fattureRaw, year);

      const state: BudgetState = {
        baseMonth: budget.baseMonth,
        items: budget.items.map((it) => ({ nome: it.nome, importo: it.importo, auto: it.auto, ordine: it.ordine })),
      };

      function save() {
        dirty = false;
        const payload = {
          baseMonth: state.baseMonth,
          items: state.items.map((it, i) => ({ nome: it.nome, importo: it.importo, auto: it.auto, ordine: i })),
        };
        void api.put(`/api/budget/${year}`, payload).catch((err) => {
          const msg = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
          const errEl = document.createElement('div');
          errEl.className = 'budget-error-toast';
          errEl.textContent = msg;
          main.insertBefore(errEl, main.firstChild);
          setTimeout(() => errEl.remove(), 4000);
        });
      }
      doSave = save;

      function scheduleSave() {
        dirty = true;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveTimer = null; save(); }, 500);
      }

      function render() {
        main.innerHTML = renderBudget(state, months, rate, nettoAnnuo);

        const netto = computeNettoMensile({ baseMonth: state.baseMonth, months, rate, nettoAnnuo }).netto;

        const baseSel = main.querySelector<HTMLSelectElement>('#budgetBaseMonth');
        baseSel?.addEventListener('change', () => {
          const v = baseSel.value;
          state.baseMonth = v === '' ? null : Number(v);
          scheduleSave();
          render();
        });

        main.querySelector<HTMLButtonElement>('#budgetAdd')?.addEventListener('click', () => {
          state.items.push({ nome: '', importo: 0, auto: false, ordine: state.items.length });
          scheduleSave();
          render();
        });

        main.querySelectorAll<HTMLElement>('.budget-row').forEach((rowEl) => {
          const idx = Number(rowEl.dataset['idx']);
          const it = state.items[idx];
          if (!it) return;

          rowEl.querySelector<HTMLInputElement>('[data-field="nome"]')?.addEventListener('change', (e) => {
            it.nome = (e.target as HTMLInputElement).value;
            scheduleSave();
          });
          rowEl.querySelector<HTMLInputElement>('[data-field="importo"]')?.addEventListener('change', (e) => {
            it.importo = parseFloat((e.target as HTMLInputElement).value) || 0;
            it.auto = false;
            scheduleSave();
            render();
          });
          rowEl.querySelector<HTMLInputElement>('[data-field="pct"]')?.addEventListener('change', (e) => {
            const pct = parseFloat((e.target as HTMLInputElement).value) || 0;
            it.importo = ceil2(netto * pct / 100);
            it.auto = false;
            scheduleSave();
            render();
          });
          rowEl.querySelector<HTMLInputElement>('[data-field="auto"]')?.addEventListener('change', (e) => {
            it.auto = (e.target as HTMLInputElement).checked;
            if (it.auto) it.importo = 0;
            scheduleSave();
            render();
          });
          rowEl.querySelector<HTMLButtonElement>('[data-field="del"]')?.addEventListener('click', () => {
            state.items.splice(idx, 1);
            scheduleSave();
            render();
          });
        });
      }

      render();
    },
  });
}
