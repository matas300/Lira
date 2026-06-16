// src/client/pages/scadenze.ts
//
// Pagina "Scadenze" (/scadenze): mostra le scadenze fiscali forfettarie
// dell'anno selezionato (14 righe dal scadenziario), con stato pagamento e
// azioni "Segna pagato" / "Annulla".
//
// Le funzioni di render sono PURE (ricevono i dati dell'endpoint, ritornano
// stringhe HTML) per essere testabili senza DOM — `mount()` le compone dentro
// `mountPage` e cabla le azioni via `lib/api.ts`.
//
// Contratto API:
//   GET  /api/scadenziario/:year → ScadenziarioView (ScadenziarioOutput + extra)
//   POST /api/pagamenti/quick-pay { scheduleKey, importo, data? } → PagamentoPublic
//   DELETE /api/pagamenti/:id → { ok: true }

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { scadenzaTiming } from '../lib/scadenza-timing';
import { openModal, alertModal } from '../components/modal';

// ─── Tipi rispecchiati dall'endpoint (senza import da @server per evitare
//     dipendenze da node_modules che non servono al client) ──────────────────

export interface PaymentBreakdown {
  id: string;
  data: string;
  importo: number;
  mode: 'pure' | 'mixed';
}

export interface ScadenziarioRow {
  id: string;
  title: string;
  family: string;
  kind: 'tax' | 'contribution';
  competenceYear: number;
  dueDate: string;
  dueDateOriginal: string;
  dueDateRolled: boolean;
  prorogaApplied: boolean;
  amount: { low: number; high: number; point: number };
  certainty: 'official' | 'estimated' | 'forecast';
  payments: PaymentBreakdown[];
  paidTotal: number;
  status: { code: 'paid' | 'underpaid' | 'overpaid' | 'estimated' | 'to_confirm'; label: string; tone: 'ok' | 'warn' | 'danger' | 'info' };
  explanation: string;
}

export interface AuditWarning {
  code: string;
  severity: 'critical' | 'high' | 'warn' | 'info';
  title: string;
  message: string;
}

export interface ScadenziarioView {
  year: number;
  method: 'storico' | 'previsionale';
  rows: ScadenziarioRow[];
  summary: {
    totalDue: number;
    totalPaid: number;
    totalResidual: number;
    nextDue: ScadenziarioRow | null;
  };
  warnings: AuditWarning[];
  methodComparison: unknown;
  transition: unknown;
  rulesRef: string;
}

// ─────────────────────────── Helpers formattativi ─────────────────────────

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Tono → classe CSS chip
function toneCls(tone: string): string {
  if (tone === 'ok') return 'chip-ok';
  if (tone === 'warn') return 'chip-warn';
  if (tone === 'danger') return 'chip-danger';
  return 'chip-info';
}

// ────────────────────────── renderSummary ──────────────────────────────────

export function renderSummary(
  summary: ScadenziarioView['summary'],
  method: ScadenziarioView['method'],
): string {
  const nextDueHtml = summary.nextDue
    ? `<div class="scad-summary-cell">
        <span class="scad-summary-label">Prossima scadenza</span>
        <span class="scad-summary-val">${esc(summary.nextDue.title)}</span>
        <span class="scad-summary-sub">${esc(summary.nextDue.dueDate)}</span>
      </div>`
    : `<div class="scad-summary-cell">
        <span class="scad-summary-label">Prossima scadenza</span>
        <span class="scad-summary-val">—</span>
      </div>`;
  return `<div class="card scad-summary">
    <div class="scad-summary-grid">
      <div class="scad-summary-cell">
        <span class="scad-summary-label">Totale dovuto</span>
        <span class="scad-summary-val">${esc(eur(summary.totalDue))}</span>
      </div>
      <div class="scad-summary-cell">
        <span class="scad-summary-label">Pagato</span>
        <span class="scad-summary-val is-positive">${esc(eur(summary.totalPaid))}</span>
      </div>
      <div class="scad-summary-cell">
        <span class="scad-summary-label">Residuo</span>
        <span class="scad-summary-val is-warn">${esc(eur(summary.totalResidual))}</span>
      </div>
      ${nextDueHtml}
    </div>
    <div class="scad-method-badge">
      Metodo: <span class="chip chip-info">${esc(method)}</span>
    </div>
  </div>`;
}

// ────────────────────────── renderRow ─────────────────────────────────────

export function renderRow(row: ScadenziarioRow, today: string): string {
  const timing = scadenzaTiming(row.dueDate, today);
  const isPaid = row.status.code === 'paid';
  const residual = Math.max(0, row.amount.point - row.paidTotal);

  // Importo: point + range se low ≠ high
  const rangeHtml = row.amount.low !== row.amount.high
    ? `<span class="scad-range">(${esc(eur(row.amount.low))} – ${esc(eur(row.amount.high))})</span>`
    : '';

  // Lista versamenti
  const paymentsHtml = row.payments.length
    ? `<ul class="scad-payments-list">${row.payments.map((p) =>
        `<li><span class="scad-pay-data">${esc(p.data)}</span> <span class="scad-pay-importo">${esc(eur(p.importo))}</span></li>`
      ).join('')}</ul>`
    : '';

  // Azioni: "Segna pagato" solo se non pagata, "Annulla" se ha pagamenti
  const payBtn = !isPaid
    ? `<button class="btn btn-primary scad-btn-pay"
         data-action="pay"
         data-key="${esc(row.id)}"
         data-residual="${esc(String(residual))}"
         data-point="${esc(String(row.amount.point))}"
         title="Segna pagato">Segna pagato</button>`
    : '';
  const unpayBtn = row.payments.length > 0
    ? `<button class="btn btn-danger scad-btn-unpay"
         data-action="unpay"
         data-ids="${esc(row.payments.map((p) => p.id).join(','))}"
         title="Annulla pagamenti">Annulla</button>`
    : '';

  return `<div class="scad-row${isPaid ? ' is-paid' : ''}">
    <div class="scad-row-date">
      <span class="scad-due-date">${esc(row.dueDate)}</span>
      <span class="chip ${esc(toneCls(timing.tone))}">${esc(timing.label)}</span>
    </div>
    <div class="scad-row-voce">
      <span class="scad-row-title">${esc(row.title)}</span>
      <span class="chip ${esc(toneCls(row.status.tone))}">${esc(row.status.label)}</span>
      <span class="scad-competenza">Competenza ${esc(String(row.competenceYear))}</span>
      <span class="scad-explanation">${esc(row.explanation)}</span>
    </div>
    <div class="scad-row-importo">
      <span class="scad-amount">${esc(eur(row.amount.point))}</span>
      ${rangeHtml}
      ${paymentsHtml}
    </div>
    <div class="scad-row-azioni">
      ${payBtn}
      ${unpayBtn}
    </div>
  </div>`;
}

// ────────────────────────── renderRowsTable ────────────────────────────────

export function renderRowsTable(rows: ScadenziarioRow[], today: string): string {
  const daPagare = rows.filter((r) => r.status.code !== 'paid');
  const pagate = rows.filter((r) => r.status.code === 'paid');

  const daPagareHtml = daPagare.length
    ? daPagare.map((r) => renderRow(r, today)).join('')
    : `<div class="scad-empty">Nessuna scadenza da pagare.</div>`;

  const pagateHtml = pagate.length
    ? pagate.map((r) => renderRow(r, today)).join('')
    : `<div class="scad-empty">Nessuna scadenza pagata.</div>`;

  const daPagareTotale = daPagare.reduce((s, r) => s + Math.max(0, r.amount.point - r.paidTotal), 0);
  const pagateTotale = pagate.reduce((s, r) => s + r.paidTotal, 0);

  return `<div class="scad-table">
    <div class="scad-section">
      <h3 class="scad-section-title">Da pagare</h3>
      <div class="scad-rows">${daPagareHtml}</div>
      ${daPagare.length ? `<div class="scad-footer">Residuo totale: <strong>${esc(eur(daPagareTotale))}</strong></div>` : ''}
    </div>
    <details class="scad-section scad-pagate">
      <summary class="scad-section-title">Pagate (${esc(String(pagate.length))})</summary>
      <div class="scad-rows">${pagateHtml}</div>
      ${pagate.length ? `<div class="scad-footer">Totale versato: <strong>${esc(eur(pagateTotale))}</strong></div>` : ''}
    </details>
  </div>`;
}

// ────────────────────────── renderWarnings ────────────────────────────────

export function renderWarnings(warnings: AuditWarning[]): string {
  if (!warnings.length) return '';
  const items = warnings.map((w) =>
    `<div class="scad-warn-item scad-warn-${esc(w.severity)}">
      <strong>${esc(w.title)}</strong>
      <p>${esc(w.message)}</p>
    </div>`
  ).join('');
  return `<div class="card scad-warn-panel">
    <h3>Avvisi</h3>
    ${items}
  </div>`;
}

// ────────────────────────── renderNeedsConfig ─────────────────────────────

export function renderNeedsConfig(year: number): string {
  return `<div class="card scad-needsconfig">
    <h2>Scadenze ${esc(year)}</h2>
    <p class="scad-note">Non ci sono ancora impostazioni fiscali per il ${esc(year)}: configura il regime e i parametri INPS per visualizzare il calendario scadenze.</p>
    <a class="btn btn-primary" href="/tasse" data-route="/tasse">Configura il ${esc(year)}</a>
  </div>`;
}

// ────────────────────────── renderError ───────────────────────────────────

function renderError(message: string): string {
  return `<div class="card scad-panel">
    <h2>Scadenze</h2>
    <p class="scad-note scad-note-warn">${esc(message)}</p>
  </div>`;
}

// ────────────────────────── renderScadenze (composizione) ─────────────────

export function renderScadenze(view: ScadenziarioView, today: string): string {
  return `<div class="scad-head">
    <h2>Scadenze ${esc(String(view.year))}</h2>
  </div>
  ${renderWarnings(view.warnings)}
  ${renderSummary(view.summary, view.method)}
  ${renderRowsTable(view.rows, today)}`;
}

// ─────────────────────────────── mount ────────────────────────────────────

/**
 * "Segna pagato" modal: chiede importo (prefill residuo) e data (default oggi).
 * Scelta: openModal con un form custom che raccoglie sia importo che data.
 * Motivazione: `promptDateModal` esiste ma raccoglie solo la data; qui serve
 * anche l'importo. Si usa `openModal` direttamente con un form inline, coerente
 * con il pattern `openFatturaModal` / `openNotaCreditoModal` in fatture.ts.
 * Concern: non esiste un `promptAmountDateModal` condiviso — questo è il primo
 * uso. Se emergerà un secondo caso identico, estrarre in modal.ts.
 */
function promptPayModal(
  title: string,
  defaultImporto: number,
  defaultData: string,
): Promise<{ importo: number; data: string } | null> {
  return new Promise((resolve) => {
    let result: { importo: number; data: string } | null = null;
    openModal({
      title,
      bodyHtml: `
        <form data-pay-form style="display:flex;flex-direction:column;gap:var(--space-3);">
          <div class="form-row">
            <label>Importo (€) *</label>
            <input class="input" type="number" step="0.01" min="0.01" data-importo
              value="${esc(String(defaultImporto))}" required />
          </div>
          <div class="form-row">
            <label>Data versamento *</label>
            <input class="input" type="date" data-data value="${esc(defaultData)}" required />
          </div>
          <p class="form-error" data-error hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary">Conferma</button>
          </div>
        </form>`,
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-pay-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        root.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          const importoStr = root.querySelector<HTMLInputElement>('[data-importo]')!.value;
          const dataStr = root.querySelector<HTMLInputElement>('[data-data]')!.value;
          const importo = parseFloat(importoStr);
          if (!importo || importo <= 0) {
            errorEl.textContent = 'Inserisci un importo valido.';
            errorEl.hidden = false;
            return;
          }
          if (!dataStr) {
            errorEl.textContent = 'Inserisci la data di versamento.';
            errorEl.hidden = false;
            return;
          }
          result = { importo, data: dataStr };
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/scadenze',
    render: async ({ main, rerender }) => {
      const year = getYear();
      const todayIso = new Date().toISOString().slice(0, 10);

      main.innerHTML = `<div class="card scad-panel"><p class="scad-note">Carico le scadenze…</p></div>`;

      let view: ScadenziarioView;
      try {
        view = await api.get<ScadenziarioView>(`/api/scadenziario/${year}`);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'YEAR_SETTINGS_NOT_FOUND') {
          main.innerHTML = renderNeedsConfig(year);
          return;
        }
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare le scadenze. Riprova.';
        main.innerHTML = renderError(msg);
        return;
      }

      main.innerHTML = renderScadenze(view, todayIso);

      // Event delegation per le azioni
      main.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const btn = target.closest<HTMLButtonElement>('[data-action]');
        if (!btn) return;

        const action = btn.dataset['action'];

        if (action === 'pay') {
          const key = btn.dataset['key'] ?? '';
          const residual = parseFloat(btn.dataset['residual'] ?? '0');
          const point = parseFloat(btn.dataset['point'] ?? '0');
          const prefill = residual > 0 ? residual : point;

          const result = await promptPayModal(`Segna pagato — ${key}`, prefill, todayIso);
          if (!result) return;

          try {
            await api.post('/api/pagamenti/quick-pay', {
              scheduleKey: key,
              importo: result.importo,
              data: result.data,
            });
            await rerender();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : 'Errore durante il pagamento.';
            await alertModal('Errore', `<p>${esc(msg)}</p>`);
          }
        }

        if (action === 'unpay') {
          const idsStr = btn.dataset['ids'] ?? '';
          const ids = idsStr.split(',').filter(Boolean);
          if (!ids.length) return;

          try {
            for (const id of ids) {
              await api.del(`/api/pagamenti/${id}`);
            }
            await rerender();
          } catch (err) {
            const msg = err instanceof ApiError ? err.message : 'Errore durante l\'annullamento.';
            await alertModal('Errore', `<p>${esc(msg)}</p>`);
          }
        }
      });
    },
  });
}
