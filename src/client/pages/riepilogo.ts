// src/client/pages/riepilogo.ts
//
// Pagina "Riepilogo" (/riepilogo): cruscotto annuale che AGGREGA i moduli a colpo
// d'occhio (sintesi fiscale, fatturato + limite 85k, prossime scadenze, CTA
// Dichiarazione). Raggiunta dal menu profilo. NON ri-deriva il dettaglio fiscale
// (resta sulla pagina Regime `/`): qui si sintetizza e si linka alle pagine.
//
// Render puri (testabili) + mount con 2 fetch in parallelo. Frontend-only:
// GET /api/tax/scenario (card 1+2) e GET /api/scadenziario/:year (card 3) esistono.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { scadenzaTiming } from '../lib/scadenza-timing';
import type { ScenarioResponse } from './regime';
import type { ScadenziarioView, ScadenziarioRow } from './scadenze';
import type { ForfettarioScenario } from '@server/lib/tax-engine';

// ── selezione pura ──

/**
 * Prossime scadenze da pagare: righe con residuo (`amount.point - paidTotal`) > 0,
 * ordinate per data di scadenza crescente, troncate alle prime `n`.
 */
export function prossimeScadenze(rows: ScadenziarioRow[], n: number): ScadenziarioRow[] {
  return rows
    // soglia mezzo centesimo: ignora il "dust" da arrotondamento (diverge da scadenze.ts che non tollera)
    .filter((r) => r.amount.point - r.paidTotal > 0.005)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, n);
}

// ── helpers formattativi (coerenti coi sibling regime.ts/scadenze.ts) ──

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(frac: number): string {
  return Math.round((Number(frac) || 0) * 100) + '%';
}
function toneCls(tone: string): string {
  if (tone === 'ok') return 'chip-ok';
  if (tone === 'warn') return 'chip-warn';
  if (tone === 'danger') return 'chip-danger';
  return 'chip-info';
}
function riepRow(label: string, value: string, tone: '' | 'positive' | 'negative' = ''): string {
  const cls = tone ? ` is-${tone}` : '';
  return `<div class="riep-row"><span class="riep-row-label">${esc(label)}</span>`
    + `<span class="riep-row-val${cls}">${esc(value)}</span></div>`;
}
function cardLink(route: string, label: string): string {
  return `<a class="riep-link" href="${esc(route)}" data-route="${esc(route)}">${esc(label)} →</a>`;
}

// ── render puri ──

export function renderSintesiCard(selected: ForfettarioScenario, grossCollected: number, nettoAnnuo: number): string {
  const imposta = selected.substituteTax;
  const inps = selected.deductibleContributionsPaid;
  const netto = Number.isFinite(nettoAnnuo) ? nettoAnnuo : grossCollected - imposta - inps;
  const effettiva = grossCollected > 0 ? (imposta + inps) / grossCollected : 0;
  return `<div class="card riep-card">
      <h3>Sintesi fiscale</h3>
      ${riepRow('Totale annuo lordo', eur(grossCollected))}
      ${riepRow('Imposta sostitutiva', eur(imposta), 'negative')}
      ${riepRow('Contributi INPS', eur(inps), 'negative')}
      ${riepRow('Netto annuo', eur(netto), 'positive')}
      ${riepRow('Netto mensile', eur(netto / 12), 'positive')}
      <div class="riep-note">% effettiva (imposta + INPS sul lordo): <b>${esc(pct(effettiva))}</b></div>
      ${cardLink('/', 'Dettaglio fiscale')}
    </div>`;
}

export function renderLimitCard(grossCollected: number, limite: number): string {
  const lim = limite > 0 ? limite : 85000;
  const ratio = grossCollected / lim;
  const pctNum = Math.round(ratio * 100);
  const width = Math.min(100, pctNum);
  const over = grossCollected >= lim;
  const near = !over && pctNum >= 80;
  const fill = over ? 'var(--color-error)' : near ? 'var(--color-warning)' : 'var(--color-primary)';
  const note = over
    ? `<div class="riep-note riep-note-warn">Soglia ${eur(lim)} superata: uscita immediata oltre 100.000 €, decadenza dall'anno successivo oltre 85.000 €.</div>`
    : near
      ? `<div class="riep-note riep-note-warn">Ti stai avvicinando alla soglia di ${eur(lim)}.</div>`
      : '';
  return `<div class="card riep-card">
      <h3>Fatturato e limite</h3>
      <div class="riep-limit-head">${esc(eur(grossCollected))} <span class="riep-muted">/ ${esc(eur(lim))} incassato</span></div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${width}%;background:${fill};"></div>
        <span class="progress-text">${pctNum}%</span>
      </div>
      ${note}
      ${cardLink('/fatture', 'Fatture')}
    </div>`;
}

export function renderScadenzeCard(prossime: ScadenziarioRow[], totalResidual: number, today: string): string {
  if (!prossime.length) {
    return `<div class="card riep-card">
      <h3>Prossime scadenze</h3>
      <p class="riep-note">Nessuna scadenza da pagare.</p>
      ${cardLink('/scadenze', 'Scadenze')}
    </div>`;
  }
  const items = prossime.map((r) => {
    const residual = Math.max(0, r.amount.point - r.paidTotal);
    const t = scadenzaTiming(r.dueDate, today);
    return `<div class="riep-scad-item">
        <span class="riep-scad-title">${esc(r.title)}</span>
        <span class="chip ${toneCls(t.tone)}">${esc(t.label)}</span>
        <span class="riep-scad-amount">${esc(eur(residual))}</span>
      </div>`;
  }).join('');
  return `<div class="card riep-card">
      <h3>Prossime scadenze</h3>
      <div class="riep-scad-list">${items}</div>
      ${riepRow('Residuo totale anno', eur(totalResidual))}
      ${cardLink('/scadenze', 'Scadenze')}
    </div>`;
}

export function renderDichiarazioneCta(): string {
  return `<div class="card riep-card riep-cta">
      <div>
        <h3>Dichiarazione dei redditi</h3>
        <p class="riep-note">Quadri LM/RR/RS/RX e modello F24 dell'anno.</p>
      </div>
      <a class="btn btn-primary" href="/dichiarazione" data-route="/dichiarazione">Apri Dichiarazione</a>
    </div>`;
}

export function renderConfigPrompt(year: number): string {
  return `<div class="card riep-card">
      <h3>Posizione fiscale ${esc(year)}</h3>
      <p class="riep-note">Anno non ancora configurato: imposta coefficiente, sostitutiva e gestione INPS per vedere la sintesi.</p>
      <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
    </div>`;
}

export function renderPage(year: number, body: string): string {
  return `<div class="riep-page">
    <div class="ys-crumb">Profilo ▸ Riepilogo</div>
    <h2>Riepilogo ${esc(year)}</h2>
    <div class="riep-grid">${body}</div>
  </div>`;
}
