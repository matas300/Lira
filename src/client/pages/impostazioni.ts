// src/client/pages/impostazioni.ts
//
// Pagina "Impostazioni" (/impostazioni): editor dei parametri fiscali per-anno
// (year_settings). Raggiunta dal menu profilo, non dalla nav principale.
// Render puri (testabili) + mount con fetch/save. Frontend-only: il backend
// GET/PUT /api/year-settings/:year esiste già (boundary check server-side).

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import {
  defaults, stateFromResponse, bodyFromState, atecoOptions, selectedAtecoIndex,
  type YsFormState,
} from '../lib/year-settings-form';

// ── helpers ──

function pctLabel(coeff: number): string {
  return Math.round(coeff * 100) + '%';
}

// ── render puri ──

export function renderConfigBanner(isNew: boolean, year: number): string {
  if (!isNew) return '';
  return `<div class="ys-banner">Anno ${esc(year)} non ancora configurato: questi sono i valori di default, modifica e salva.</div>`;
}

export function renderForm(s: YsFormState): string {
  const opts = atecoOptions();
  const selIdx = selectedAtecoIndex(s.coefficiente, opts);
  const atecoHtml = opts.map((o, i) =>
    `<option value="${esc(o.coefficiente)}"${i === selIdx ? ' selected' : ''}>${esc(o.label)} — ${esc(pctLabel(o.coefficiente))}</option>`,
  ).join('');

  const categoriaHtml = s.inpsMode === 'artigiani_commercianti'
    ? `<div class="ys-field">
        <label>Categoria</label>
        <select data-field="inpsCategoria">
          <option value="artigiano"${s.inpsCategoria === 'artigiano' ? ' selected' : ''}>Artigiano</option>
          <option value="commerciante"${s.inpsCategoria === 'commerciante' ? ' selected' : ''}>Commerciante</option>
        </select>
      </div>`
    : '';

  const riduzioneSub = s.riduzione35
    ? `<div class="ys-sub">
        <label class="ys-check"><input type="checkbox" data-field="riduzione35Comunicata"${s.riduzione35Comunicata ? ' checked' : ''}> Comunicata all'INPS</label>
        <div class="ys-field">
          <label>Data comunicazione</label>
          <input type="date" data-field="riduzione35DataComunicazione" value="${esc(s.riduzione35DataComunicazione ?? '')}">
        </div>
      </div>`
    : '';

  return `<form class="card ys-form" data-ys-form>
    <div class="ys-grid">
      <div class="ys-field">
        <label>Regime</label>
        <div class="ys-toggle" data-field="regime">
          <button type="button" class="ys-toggle-btn is-active" data-regime="forfettario">Forfettario</button>
          <button type="button" class="ys-toggle-btn is-disabled" data-regime="ordinario" disabled title="non ancora supportato">Ordinario ✕</button>
        </div>
        <span class="ys-hint">Ordinario non ancora supportato.</span>
      </div>

      <div class="ys-field">
        <label>Imposta sostitutiva</label>
        <div class="ys-seg" data-field="impostaSostitutiva">
          <button type="button" class="ys-seg-btn${s.impostaSostitutiva === 0.15 ? ' is-active' : ''}" data-sost="0.15">15% standard</button>
          <button type="button" class="ys-seg-btn${s.impostaSostitutiva === 0.05 ? ' is-active' : ''}" data-sost="0.05">5% startup</button>
        </div>
      </div>

      <div class="ys-field">
        <label>Attività ATECO → coefficiente</label>
        <select data-field="coefficiente">${atecoHtml}</select>
        <span class="ys-hint">DM 23/01/2015. Coefficiente: ${esc(pctLabel(s.coefficiente))}.</span>
      </div>

      <div class="ys-field">
        <label>Gestione INPS</label>
        <select data-field="inpsMode">
          <option value="gestione_separata"${s.inpsMode === 'gestione_separata' ? ' selected' : ''}>Gestione Separata</option>
          <option value="artigiani_commercianti"${s.inpsMode === 'artigiani_commercianti' ? ' selected' : ''}>Artigiani / Commercianti</option>
        </select>
      </div>

      ${categoriaHtml}

      <div class="ys-field">
        <label>Limite forfettario (€)</label>
        <input type="number" data-field="limiteForfettario" value="${esc(s.limiteForfettario)}" step="1" min="0">
      </div>

      <div class="ys-field">
        <label>Tariffa giornaliera (€)</label>
        <input type="number" data-field="tariffaGiornaliera" value="${esc(s.tariffaGiornaliera ?? '')}" step="0.01" min="0" placeholder="es. 250">
        <span class="ys-hint">Usata anche da "Crea fattura dal calendario".</span>
      </div>
    </div>

    <div class="ys-checks">
      <label class="ys-check"><input type="checkbox" data-field="riduzione35"${s.riduzione35 ? ' checked' : ''}> Riduzione contributiva 35% (artigiani/commercianti)</label>
      ${riduzioneSub}
      <label class="ys-check"><input type="checkbox" data-field="haRedditoDipendente"${s.haRedditoDipendente ? ' checked' : ''}> Ho anche reddito da lavoro dipendente</label>
    </div>

    <details class="ys-advanced">
      <summary>Impostazioni avanzate</summary>
      <div class="ys-grid">
        <div class="ys-field">
          <label>Metodo scadenziario</label>
          <select data-field="scadenziarioMetodo">
            <option value="storico"${s.scadenziarioMetodo === 'storico' ? ' selected' : ''}>Storico</option>
            <option value="previsionale"${s.scadenziarioMetodo === 'previsionale' ? ' selected' : ''}>Previsionale</option>
          </select>
        </div>
        <div class="ys-field">
          <label>Proroga saldo (solo luglio)</label>
          <input type="date" data-field="prorogaSaldoAt" value="${esc(s.prorogaSaldoAt ?? '')}">
        </div>
        <div class="ys-field"><label>Primo anno — fatturato prec.</label><input type="number" data-field="primoAnnoFatturatoPrec" value="${esc(s.primoAnnoFatturatoPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — imposta prec.</label><input type="number" data-field="primoAnnoImpostaPrec" value="${esc(s.primoAnnoImpostaPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — acconti imposta prec.</label><input type="number" data-field="primoAnnoAccontiImpostaPrec" value="${esc(s.primoAnnoAccontiImpostaPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — contributi variabili prec.</label><input type="number" data-field="primoAnnoContribVariabiliPrec" value="${esc(s.primoAnnoContribVariabiliPrec ?? '')}" step="0.01"></div>
        <div class="ys-field"><label>Primo anno — acconti contributi prec.</label><input type="number" data-field="primoAnnoAccontiContribPrec" value="${esc(s.primoAnnoAccontiContribPrec ?? '')}" step="0.01"></div>
      </div>
    </details>

    <div class="ys-actions">
      <span class="ys-msg" data-ys-msg></span>
      <button type="button" class="btn" data-ys-reset>Annulla</button>
      <button type="submit" class="btn btn-primary" data-ys-save>Salva parametri</button>
    </div>
  </form>`;
}

export function renderPage(s: YsFormState, isNew: boolean, year: number): string {
  return `<div class="ys-page">
    <div class="ys-crumb">Profilo ▸ Impostazioni</div>
    <h2>Impostazioni — Parametri fiscali ${esc(year)}</h2>
    ${renderConfigBanner(isNew, year)}
    ${renderForm(s)}
  </div>`;
}
