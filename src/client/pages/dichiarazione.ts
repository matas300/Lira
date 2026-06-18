// src/client/pages/dichiarazione.ts
//
// Pagina "Dichiarazione" (/dichiarazione): vista READ-ONLY della dichiarazione PF
// forfettaria (frontespizio + quadri LM/RR/RX/RS + warning), da
// GET /api/dichiarazione/:year. La verità fiscale è server-side; qui si formatta.
// F24 (6B) e override (6C) arriveranno dopo. Pattern regime.ts: render puri + mount.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import type { Dichiarazione, Frontespizio, Rigo, DichiarazioneWarning, F24Modulo } from '@server/lib/dichiarazione-engine';

interface DichiarazioneResponse {
  year: number;
  needsConfig: boolean;
  dichiarazione?: Dichiarazione;
}

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function sourceBadge(source: Rigo['source']): string {
  if (source === 'from-profile') return '<span class="dich-src">da profilo</span>';
  if (source === 'zero') return '<span class="dich-src">—</span>';
  return '';
}

export function renderFrontespizio(f: Frontespizio): string {
  const nome = [f.cognome, f.nome].filter(Boolean).join(' ') || '—';
  return `<div class="card dich-card dich-front">
    <div class="ys-crumb">Profilo ▸ Dichiarazione</div>
    <h2>Dichiarazione Redditi PF ${esc(f.annoImposta)}</h2>
    <div class="dich-front-grid">
      <div><span class="dich-k">Contribuente</span><span class="dich-v">${esc(nome)}</span></div>
      <div><span class="dich-k">Codice fiscale</span><span class="dich-v">${esc(f.codiceFiscale || '—')}</span></div>
      <div><span class="dich-k">Regime</span><span class="dich-v">${esc(f.regime)} (forfettario)</span></div>
      <div><span class="dich-k">Tipo</span><span class="dich-v">${esc(f.tipoDichiarazione)}</span></div>
    </div>
    <p class="dich-note">Anno d'imposta ${esc(f.annoImposta)} → dichiarazione da presentare nel ${esc(f.annoImposta + 1)}.</p>
  </div>`;
}

export function renderQuadro(titolo: string, righi: Rigo[]): string {
  if (!righi.length) {
    return `<div class="card dich-card"><h3>${esc(titolo)}</h3><p class="dich-note">Nessun dato in questa versione.</p></div>`;
  }
  const rows = righi.map((r) =>
    `<div class="dich-row"><span class="dich-row-k">${esc(r.key)} · ${esc(r.label)} ${sourceBadge(r.source)}</span>`
    + `<span class="dich-row-v">${esc(eur(r.value))}</span></div>`,
  ).join('');
  return `<div class="card dich-card"><h3>${esc(titolo)}</h3>${rows}</div>`;
}

export function renderWarnings(warnings: DichiarazioneWarning[]): string {
  if (!warnings.length) return '';
  const items = warnings.map((w) =>
    `<div class="dich-warn dich-warn-${esc(w.severity)}">${esc(w.message)}</div>`,
  ).join('');
  return `<div class="card dich-card dich-warns"><h3>Controlli</h3>${items}</div>`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export function renderF24(moduli: F24Modulo[]): string {
  if (!moduli.length) return '';
  const sezione = (titolo: string, righe: F24Modulo['righe']): string => {
    if (!righe.length) return '';
    const rows = righe.map((r) =>
      `<div class="dich-row"><span class="dich-row-k">${esc(r.codice)} · ${esc(r.descrizione)} <span class="dich-src">rif. ${esc(r.annoRiferimento)}</span></span>`
      + `<span class="dich-row-v">${esc(eur(r.importo))}</span></div>`,
    ).join('');
    return `<div class="dich-f24-sez"><h4>${esc(titolo)}</h4>${rows}</div>`;
  };
  const cards = moduli.map((m) => {
    const erario = m.righe.filter((r) => r.sezione === 'erario');
    const inps = m.righe.filter((r) => r.sezione === 'inps');
    const proroga = m.prorogaApplied ? ' <span class="dich-src">proroga</span>' : '';
    return `<div class="card dich-card dich-f24-mod">
      <h3>F24 — scadenza ${esc(fmtDate(m.scadenza))}${proroga}</h3>
      ${sezione('Erario', erario)}
      ${sezione('INPS', inps)}
      <div class="dich-row dich-f24-tot"><span class="dich-row-k">Totale modulo</span><span class="dich-row-v">${esc(eur(m.totale))}</span></div>
    </div>`;
  }).join('');
  return `<div class="dich-f24">
    <div class="card dich-card"><h3>Modelli F24</h3>
      <p class="dich-note">Versamenti da dichiarazione: saldo dell'anno d'imposta + acconti per l'anno successivo. Prospetto di calcolo (sede/matricola INPS escluse).</p>
    </div>
    ${cards}
  </div>`;
}

export function renderConfigPrompt(year: number): string {
  return `<div class="card dich-card">
    <h2>Dichiarazione ${esc(year)}</h2>
    <p class="dich-note">Anno non ancora configurato: imposta i parametri fiscali per generare la dichiarazione.</p>
    <a class="btn btn-primary" href="/impostazioni" data-route="/impostazioni">Configura il ${esc(year)}</a>
  </div>`;
}

export function renderPage(d: Dichiarazione): string {
  const rrTitolo = d.quadroRR.sezione === 'gestione_separata'
    ? 'Quadro RR — Gestione separata' : 'Quadro RR — Artigiani/Commercianti';
  return `<div class="dich-page">
    ${renderFrontespizio(d.frontespizio)}
    ${renderWarnings(d.warnings)}
    ${renderQuadro('Quadro LM — Reddito forfettario', d.quadroLM)}
    ${renderQuadro(rrTitolo, d.quadroRR.righi)}
    ${renderQuadro('Quadro RX — Compensazioni', d.quadroRX)}
    ${renderQuadro('Quadro RS — Dati informativi', d.quadroRS)}
    ${renderF24(d.f24)}
  </div>`;
}

// ── mount ──

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/dichiarazione',
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card dich-card"><p class="dich-note">Carico la dichiarazione…</p></div>`;
      try {
        const data = await api.get<DichiarazioneResponse>(`/api/dichiarazione/${year}`);
        if (data.needsConfig || !data.dichiarazione) {
          main.innerHTML = renderConfigPrompt(data.year ?? year);
          return;
        }
        main.innerHTML = renderPage(data.dichiarazione);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare la dichiarazione. Riprova.';
        main.innerHTML = `<div class="card dich-card"><h2>Dichiarazione</h2><p class="dich-note dich-warn-error">${esc(msg)}</p></div>`;
      }
    },
  });
}
