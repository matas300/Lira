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
  if (source === 'override') return '<span class="dich-src dich-src-ovr">rettifica</span>';
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

function lmVal(d: Dichiarazione, key: string): number {
  return d.quadroLM.find((r) => r.key === key)?.value
    ?? d.quadroRX.find((r) => r.key === key)?.value ?? 0;
}

function lmSrc(d: Dichiarazione, key: string): string {
  return d.quadroLM.find((r) => r.key === key)?.source
    ?? d.quadroRX.find((r) => r.key === key)?.source ?? 'computed';
}

export function renderRettifiche(d: Dichiarazione): string {
  const acc = lmVal(d, 'LM45');
  const cred = lmVal(d, 'LM40');
  const credPrec = lmVal(d, 'LM43');
  return `<div class="card dich-card dich-adj">
    <h3>Rettifiche manuali</h3>
    <p class="dich-note">Imposta i valori solo se differiscono dal calcolo automatico. Lascia vuoto/azzera per usare il valore calcolato. Gli acconti versati di default sono stimati dai pagamenti registrati: verificali con gli F24 effettivi.</p>
    <div class="dich-adj-grid">
      <label>Acconti versati (LM45)<input type="number" step="1" min="0" id="adj-acconti" value="${esc(acc)}" data-default="${esc(acc)}" data-overridden="${esc(lmSrc(d, 'LM45') === 'override')}"></label>
      <label>Crediti d'imposta (LM40)<input type="number" step="1" min="0" id="adj-crediti" value="${esc(cred)}" data-default="${esc(cred)}" data-overridden="${esc(lmSrc(d, 'LM40') === 'override')}"></label>
      <label>Credito anno precedente (LM43)<input type="number" step="1" min="0" id="adj-credprec" value="${esc(credPrec)}" data-default="${esc(credPrec)}" data-overridden="${esc(lmSrc(d, 'LM43') === 'override')}"></label>
    </div>
    <div class="dich-adj-actions">
      <button class="btn btn-primary" type="button" id="adj-save">Salva rettifiche</button>
      <button class="btn" type="button" id="adj-reset">Ripristina calcolato</button>
      <span class="dich-note" id="adj-msg"></span>
    </div>
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
    ${renderRettifiche(d)}
  </div>`;
}

// ── mount ──

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/dichiarazione',
    render: async ({ main }) => {
      const year = getYear();
      const paint = (d: Dichiarazione): void => {
        main.innerHTML = renderPage(d);
        const num = (id: string): number | null => {
          const el = main.querySelector<HTMLInputElement>(id);
          const v = el && el.value.trim() !== '' ? Number(el.value) : null;
          return v != null && Number.isFinite(v) && v >= 0 ? v : null;
        };
        const knob = (id: string): number | null => {
          const el = main.querySelector<HTMLInputElement>(id);
          const v = num(id);
          if (v == null) return null;                 // vuoto/invalido → torna al calcolato
          if (el?.dataset.overridden === 'true') return v; // override attivo → preserva/aggiorna, non azzerare
          const def = Number(el?.dataset.default ?? 'NaN');
          // knob calcolato: invia solo se differisce dal default calcolato
          if (Number.isFinite(def) && Math.round(v * 100) === Math.round(def * 100)) return null;
          return v;
        };
        const msg = main.querySelector<HTMLElement>('#adj-msg');
        const save = main.querySelector<HTMLButtonElement>('#adj-save');
        const reset = main.querySelector<HTMLButtonElement>('#adj-reset');
        const patch = async (bodyObj: Record<string, number | null>): Promise<void> => {
          if (msg) msg.textContent = 'Salvataggio…';
          try {
            const resp = await api.patch<DichiarazioneResponse>(`/api/dichiarazione/${year}`, bodyObj);
            if (resp.dichiarazione) paint(resp.dichiarazione);
          } catch (err) {
            if (msg) msg.textContent = err instanceof ApiError ? err.message : 'Errore nel salvataggio.';
          }
        };
        save?.addEventListener('click', () => void patch({ accontiVersati: knob('#adj-acconti'), creditiImposta: knob('#adj-crediti'), creditoAnnoPrec: knob('#adj-credprec') }));
        reset?.addEventListener('click', () => void patch({ accontiVersati: null, creditiImposta: null, creditoAnnoPrec: null }));
      };
      main.innerHTML = `<div class="card dich-card"><p class="dich-note">Carico la dichiarazione…</p></div>`;
      try {
        const data = await api.get<DichiarazioneResponse>(`/api/dichiarazione/${year}`);
        if (data.needsConfig || !data.dichiarazione) {
          main.innerHTML = renderConfigPrompt(data.year ?? year);
          return;
        }
        paint(data.dichiarazione);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare la dichiarazione. Riprova.';
        main.innerHTML = `<div class="card dich-card"><h2>Dichiarazione</h2><p class="dich-note dich-warn-error">${esc(msg)}</p></div>`;
      }
    },
  });
}
