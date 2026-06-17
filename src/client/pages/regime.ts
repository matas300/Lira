// src/client/pages/regime.ts
//
// Pagina "Regime Forfettario" (home `/`): posizione fiscale REALE dell'anno
// selezionato, alimentata da `GET /api/tax/scenario?year=YYYY`.
//
// Le funzioni di render sono PURE (ricevono i dati dell'endpoint, ritornano
// stringhe HTML) per essere testabili senza DOM — `mount()` le compone dentro
// `mountPage`. Port fedele delle sezioni "Calcolo" + "Riepilogo" di CalcoliVari
// (`app-calcolo.js`): donut, sintesi, barra limite, tabella mensile, base
// fiscale (formula), confronto storico/previsionale, warning, breakdown INPS,
// liquidità (cassa).
//
// Ogni valore dinamico passa per `esc()`. La verità fiscale è server-side: qui
// si formatta soltanto.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { renderDonut } from '../components/donut';
import type { ForfettarioScenario, ComparisonOutput } from '@server/lib/tax-engine';

// ── Contratto endpoint (sorgente di verità condivisa BE↔FE, vedi tax.ts) ──
export interface MonthlyRow {
  month: number;
  lordo: number;
  netto: number;
  tasseContrib: number;
  fonte: string;
}

export interface ScenarioResponse {
  year: number;
  needsConfig: boolean;
  grossCollected?: number;
  limite?: number;
  nettoAnnuo?: number;
  comparison?: ComparisonOutput;
  monthly?: MonthlyRow[];
}

const MONTHS_SHORT = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(frac: number): string {
  return Math.round((Number(frac) || 0) * 100) + '%';
}

/** Riga sintesi "label … valore" con tono semantico (positive/negative/highlight). */
function row(label: string, value: string, opts: { highlight?: boolean; tone?: 'positive' | 'negative' } = {}): string {
  const cls = ['summary-row'];
  if (opts.highlight) cls.push('is-highlight');
  if (opts.tone) cls.push(opts.tone === 'positive' ? 'is-positive' : 'is-negative');
  return `<div class="${cls.join(' ')}"><span class="summary-label">${esc(label)}</span>`
    + `<span class="summary-val">${esc(value)}</span></div>`;
}

// ─────────────────────────────── Sintesi ───────────────────────────────

/**
 * In sintesi: lordo, imposta, INPS, netto annuo e mensile.
 * `nettoAnnuo` arriva dall'endpoint (echo per evitare drift di arrotondamento);
 * se assente lo si deriva.
 */
export function renderSintesi(selected: ForfettarioScenario, grossCollected: number, nettoAnnuo: number): string {
  const imposta = selected.substituteTax;
  const inps = selected.deductibleContributionsPaid;
  const netto = Number.isFinite(nettoAnnuo) ? nettoAnnuo : grossCollected - imposta - inps;
  const effettiva = grossCollected > 0 ? (imposta + inps) / grossCollected : 0;
  return `<div class="card regime-panel">
      <h3>In sintesi</h3>
      ${row('Totale annuo lordo', eur(grossCollected), { highlight: true })}
      ${row('Imposta sostitutiva', eur(imposta), { tone: 'negative' })}
      ${row('Contributi INPS', eur(inps), { tone: 'negative' })}
      ${row('Netto annuo', eur(netto), { highlight: true, tone: 'positive' })}
      ${row('Netto mensile', eur(netto / 12), { tone: 'positive' })}
      <div class="regime-note">% effettiva (imposta + INPS sul lordo): <b>${esc(pct(effettiva))}</b></div>
    </div>`;
}

// ─────────────────────────── Barra limite 85k ───────────────────────────

/**
 * Barra di avvicinamento alla soglia forfettario. >100% → superamento (rosso),
 * ≥80% → warning (giallo). 100.000 € = uscita immediata (L. 197/2022).
 */
export function renderLimitBar(grossCollected: number, limite: number): string {
  const lim = limite > 0 ? limite : 85000;
  const ratio = grossCollected / lim;
  const pctNum = Math.round(ratio * 100);
  const width = Math.min(100, pctNum);
  const over = grossCollected >= lim;
  const near = !over && pctNum >= 80;
  const fill = over ? 'var(--color-error)' : near ? 'var(--color-warning)' : 'var(--color-primary)';
  const note = over
    ? `<div class="regime-note regime-note-warn">Soglia ${eur(lim)} superata: verifica la permanenza nel regime (uscita immediata oltre 100.000 €, decadenza dall'anno successivo oltre 85.000 €).</div>`
    : near
      ? `<div class="regime-note regime-note-warn">Ti stai avvicinando alla soglia di ${eur(lim)}.</div>`
      : '';
  return `<div class="card regime-panel regime-limit">
      <h3>Limite ricavi forfettario</h3>
      <div class="regime-limit-head">${esc(eur(grossCollected))} / ${esc(eur(lim))}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${width}%;background:${fill};"></div>
        <span class="progress-text">${pctNum}%</span>
      </div>
      ${note}
    </div>`;
}

// ─────────────────────────── Tabella mensile ───────────────────────────

export function renderMonthlyTable(monthly: MonthlyRow[]): string {
  if (!monthly.length) {
    return `<div class="card regime-panel"><h3>Andamento mensile</h3>
      <p class="regime-note">Nessun incasso registrato per l'anno selezionato.</p></div>`;
  }
  const rows = monthly.map((m) => {
    const idx = Math.min(11, Math.max(0, m.month - 1));
    return `<div class="monthly-row">
        <span class="monthly-mese">${esc(MONTHS_SHORT[idx] ?? String(m.month))}</span>
        <span class="monthly-lordo">${esc(eur(m.lordo))}</span>
        <span class="monthly-netto">${esc(eur(m.netto))}</span>
        <span class="monthly-tasse">${esc(eur(m.tasseContrib))}</span>
        <span class="monthly-fonte">${esc(m.fonte)}</span>
      </div>`;
  }).join('');
  return `<div class="card regime-panel">
      <h3>Andamento mensile</h3>
      <div class="monthly-table">
        <div class="monthly-header">
          <span>Mese</span><span>Lordo</span><span>Netto</span><span>Tasse+C.</span><span>Fonte</span>
        </div>
        ${rows}
      </div>
    </div>`;
}

// ─────────────────────────── Base fiscale (formula) ───────────────────────────

export function renderFormula(selected: ForfettarioScenario): string {
  const steps = selected.formula.map((step) => {
    const tone = /imposta/i.test(step.label) ? { tone: 'negative' as const } : {};
    const hl = /ricavi|imponibile fiscale/i.test(step.label) ? { highlight: true } : {};
    return row(step.label, eur(step.amount), { ...hl, ...tone });
  }).join('');
  const explanation = selected.explanation.map((e) => `<p>${esc(e)}</p>`).join('');
  return `<div class="card regime-panel">
      <h3>Base fiscale forfettaria</h3>
      ${steps}
      <div class="regime-explanation">${explanation}</div>
    </div>`;
}

// ─────────────────────────── Confronto storico vs previsionale ───────────────────────────

export function renderComparison(comparison: ComparisonOutput): string {
  const prudentialLabel = comparison.prudential === 'previsionale' ? 'Previsionale' : 'Storico';
  const liquidityLabel = comparison.liquidity === 'previsionale' ? 'Previsionale' : 'Storico';
  const attivo = comparison.selectedMethod === 'previsionale' ? 'Previsionale' : 'Storico';
  return `<div class="card regime-panel">
      <h3>Storico vs Previsionale</h3>
      ${row('Metodo attivo', attivo, { highlight: true })}
      ${row('Metodo più prudente', prudentialLabel)}
      ${row('Metodo più leggero sulla liquidità', liquidityLabel)}
      ${row('Acconti imposta — storico', eur(comparison.historical.taxAcconti.total), { tone: 'negative' })}
      ${row('Acconti imposta — previsionale', eur(comparison.previsionale.taxAcconti.total), { tone: 'negative' })}
      ${row('Contributi deducibili — storico', eur(comparison.historical.deductibleContributionsPaid))}
      ${row('Contributi deducibili — previsionale', eur(comparison.previsionale.deductibleContributionsPaid))}
    </div>`;
}

// ─────────────────────────── Warning fiscali ───────────────────────────

export function renderWarnings(warnings: string[]): string {
  if (!warnings.length) return '';
  const items = warnings.map((w) => `<div class="regime-warn-item">${esc(w)}</div>`).join('');
  return `<div class="card regime-panel regime-warn-panel">
      <h3>Warning fiscali</h3>
      <div class="regime-warn-list">${items}</div>
    </div>`;
}

// ─────────────────────────── Breakdown INPS ───────────────────────────

/**
 * Dettaglio contributi INPS: quote fisse (coda anno precedente + rate dell'anno)
 * e variabili dovuti. La gestione separata non ha quote fisse → fissi a 0.
 */
export function renderInpsBreakdown(selected: ForfettarioScenario): string {
  const fissi = selected.previousFixedTail + selected.currentFixedWithinYear;
  const variabili = selected.contributiVariabiliDovuti;
  const totaleDeducibile = selected.deductibleContributionsPaid;
  return `<div class="card regime-panel">
      <h3>Contributi INPS</h3>
      ${row('Quote fisse (rate dell\'anno)', eur(fissi))}
      ${row('Contributi variabili dovuti', eur(variabili))}
      ${row('Totale deducibile pagato/pianificato', eur(totaleDeducibile), { highlight: true })}
      <div class="regime-note">I contributi variabili sono dovuti a saldo il 30/6 dell'anno successivo e generano gli acconti.</div>
    </div>`;
}

// ─────────────────────────── Liquidità (cassa) ───────────────────────────

/**
 * Prospettiva di cassa: uscite gestite nell'anno (contributi dell'anno +
 * acconti imposta) e dettaglio acconti imposta/contributi.
 */
export function renderCash(selected: ForfettarioScenario): string {
  return `<div class="card regime-panel">
      <h3>Liquidità gestita</h3>
      ${row('Saldo imposta sostitutiva', eur(selected.taxSaldo), { tone: 'negative' })}
      ${row('Acconti imposta (anno)', eur(selected.taxAcconti.total), { tone: 'negative' })}
      ${row('Acconti contributi (anno)', eur(selected.contributionAcconti.total), { tone: 'negative' })}
      ${row('Coda contributi fissi anno precedente', eur(selected.previousFixedTail))}
      ${row('Uscite gestite nell\'anno', eur(selected.managedCashOutflows), { highlight: true })}
      <div class="regime-note">La cassa somma le uscite reali (contributi versati nell'anno + acconti imposta), distinta dalla competenza fiscale.</div>
    </div>`;
}

// ─────────────────────────── needsConfig CTA ───────────────────────────

export function renderNeedsConfig(year: number): string {
  return `<div class="card regime-needsconfig">
      <h2>Regime Forfettario ${esc(year)}</h2>
      <p class="regime-note">Non ci sono ancora impostazioni fiscali per il ${esc(year)}: coefficiente, aliquota sostitutiva e gestione INPS servono per calcolare la tua posizione.</p>
      <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
    </div>`;
}

// ─────────────────────────── Errore di rete ───────────────────────────

function renderError(message: string): string {
  return `<div class="card regime-panel">
      <h2>Regime Forfettario</h2>
      <p class="regime-note regime-note-warn">${esc(message)}</p>
    </div>`;
}

// ─────────────────────────── Composizione completa ───────────────────────────

function renderScenario(data: ScenarioResponse): string {
  const comparison = data.comparison!;
  const selected = comparison.selected;
  const gross = data.grossCollected ?? selected.grossCollected;
  const limite = data.limite ?? 85000;
  const imposta = selected.substituteTax;
  const inps = selected.deductibleContributionsPaid;
  const nettoAnnuo = data.nettoAnnuo ?? gross - imposta - inps;
  const netto = Number.isFinite(nettoAnnuo) ? nettoAnnuo : gross - imposta - inps;

  return `
    <div class="regime-head">
      <h2>Regime Forfettario ${esc(data.year)}</h2>
    </div>
    <div class="regime-grid">
      <div class="card regime-panel regime-donut-panel">
        <h3>Ripartizione del lordo</h3>
        ${renderDonut({ netto, imposta, inps })}
      </div>
      ${renderSintesi(selected, gross, nettoAnnuo)}
      ${renderLimitBar(gross, limite)}
      ${renderFormula(selected)}
      ${renderComparison(comparison)}
      ${renderInpsBreakdown(selected)}
      ${renderCash(selected)}
      ${renderWarnings(comparison.warnings)}
      ${renderMonthlyTable(data.monthly ?? [])}
    </div>`;
}

// ─────────────────────────────── mount ───────────────────────────────

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/',
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card regime-panel"><p class="regime-note">Carico la posizione fiscale…</p></div>`;
      try {
        const data = await api.get<ScenarioResponse>(`/api/tax/scenario?year=${year}`);
        if (data.needsConfig || !data.comparison) {
          main.innerHTML = renderNeedsConfig(data.year ?? year);
          return;
        }
        main.innerHTML = renderScenario(data);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare la posizione fiscale. Riprova.';
        main.innerHTML = renderError(msg);
      }
    },
  });
}
