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
