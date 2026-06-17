// src/client/pages/profilo-piva.ts
//
// Pagina "Profilo P.IVA" (/profilo-piva): editor dei dati di attività del
// profilo attivo (profiles.attivita) + giorniIncasso. Raggiunta dal menu
// profilo. Render puri (testabili) + mount con fetch/save. Backend:
// GET/PATCH /api/profiles/active. La data inizio attività alimenta il
// controllo startup 5% in /impostazioni (year-settings).

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { atecoGruppiUI } from '@shared/ateco-coefficienti';
import {
  attivitaDefaults, attivitaFromResponse, attivitaToBody, fieldError, type AttivitaState,
} from '../lib/profile-form';

// ── render puri ──

function txt(field: string, label: string, value: string, attrs = ''): string {
  return `<div class="pf-field">
    <label>${esc(label)}</label>
    <input type="text" data-field="${esc(field)}" value="${esc(value)}" ${attrs}>
    <span class="pf-err" data-err="${esc(field)}"></span>
  </div>`;
}

function atecoSelect(selected: string): string {
  const opts = atecoGruppiUI().map((g) => {
    const val = String(g.coefficiente); // es. "0.78"
    const pct = Math.round(g.coefficiente * 100) + '%';
    return `<option value="${esc(val)}"${val === selected ? ' selected' : ''}>${esc(g.label)} — ${esc(pct)}</option>`;
  }).join('');
  return `<div class="pf-field">
    <label>Gruppo ATECO (coefficiente)</label>
    <select data-field="ateco_gruppo"><option value="">—</option>${opts}</select>
  </div>`;
}

export function renderForm(s: AttivitaState, giorniIncasso: number): string {
  return `<form class="card ys-form" data-pf-form>
    <h3 class="pf-h">Attività</h3>
    <div class="ys-grid">
      ${txt('partita_iva', 'Partita IVA', s.partita_iva)}
      ${txt('codice_ateco', 'Codice ATECO', s.codice_ateco, 'placeholder="es. 62.01.00"')}
      ${txt('descrizione_attivita', 'Descrizione attività', s.descrizione_attivita)}
      ${atecoSelect(s.ateco_gruppo)}
      ${txt('comune_domicilio', 'Comune domicilio attività', s.comune_domicilio)}
      <div class="pf-field">
        <label>Data inizio attività</label>
        <input type="text" data-field="data_inizio_attivita" value="${esc(s.data_inizio_attivita)}" placeholder="AAAA-MM-GG">
        <span class="ys-hint">Determina l'anno di apertura: alimenta il controllo <a href="/impostazioni" data-route="/impostazioni">startup 5%</a> nelle Impostazioni.</span>
      </div>
    </div>

    <h3 class="pf-h">Fatturazione</h3>
    <div class="ys-grid">
      <div class="pf-field">
        <label>Giorni incasso (default scadenza pagamento)</label>
        <input type="number" data-field="giorniIncasso" value="${esc(giorniIncasso)}" step="1" min="0" max="365">
      </div>
    </div>

    <div class="ys-actions">
      <span class="ys-msg" data-pf-msg></span>
      <button type="button" class="btn" data-pf-reset>Annulla</button>
      <button type="submit" class="btn btn-primary">Salva</button>
    </div>
  </form>`;
}

export function renderPage(s: AttivitaState, giorniIncasso: number): string {
  return `<div class="ys-page">
    <div class="ys-crumb">Profilo ▸ Profilo P.IVA</div>
    <h2>Profilo P.IVA</h2>
    ${renderForm(s, giorniIncasso)}
  </div>`;
}
