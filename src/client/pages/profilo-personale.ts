// src/client/pages/profilo-personale.ts
//
// Pagina "Profilo personale" (/profilo-personale): editor dei dati anagrafici
// del profilo attivo (profiles.anagrafica) + displayName. Raggiunta dal menu
// profilo. Render puri (testabili) + mount con fetch/save. Backend:
// GET/PATCH /api/profiles/active.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import {
  anagraficaDefaults, anagraficaFromResponse, anagraficaToBody, copyResidenzaToDomicilio,
  fieldError, type AnagraficaState,
} from '../lib/profile-form';

// ── render puri ──

function txt(field: string, label: string, value: string, attrs = ''): string {
  return `<div class="pf-field">
    <label>${esc(label)}</label>
    <input type="text" data-field="${esc(field)}" value="${esc(value)}" ${attrs}>
    <span class="pf-err" data-err="${esc(field)}"></span>
  </div>`;
}

function indirizzoBlock(prefix: 'residenza' | 'domicilio_fiscale', v: AnagraficaState['residenza']): string {
  return `<div class="ys-grid">
    ${txt(`${prefix}.indirizzo`, 'Indirizzo', v.indirizzo)}
    ${txt(`${prefix}.cap`, 'CAP', v.cap)}
    ${txt(`${prefix}.citta`, 'Città', v.citta)}
    ${txt(`${prefix}.provincia`, 'Provincia', v.provincia)}
  </div>`;
}

export function renderForm(displayName: string, s: AnagraficaState): string {
  return `<form class="card ys-form" data-pf-form>
    <h3 class="pf-h">Identificativi</h3>
    <div class="ys-grid">
      ${txt('displayName', 'Nome profilo (visualizzato)', displayName)}
      ${txt('cf', 'Codice fiscale', s.cf)}
      ${txt('nome', 'Nome', s.nome)}
      ${txt('cognome', 'Cognome', s.cognome)}
      ${txt('sesso', 'Sesso (M/F)', s.sesso)}
      ${txt('data_nascita', 'Data di nascita', s.data_nascita, 'placeholder="AAAA-MM-GG"')}
      ${txt('comune_nascita', 'Comune di nascita', s.comune_nascita)}
      ${txt('prov_nascita', 'Provincia di nascita', s.prov_nascita)}
    </div>

    <h3 class="pf-h">Residenza</h3>
    ${indirizzoBlock('residenza', s.residenza)}

    <h3 class="pf-h">Domicilio fiscale
      <label class="pf-same"><input type="checkbox" data-same-domicilio> uguale alla residenza</label>
    </h3>
    <div data-domicilio-wrap>${indirizzoBlock('domicilio_fiscale', s.domicilio_fiscale)}</div>

    <h3 class="pf-h">Recapiti</h3>
    <div class="ys-grid">
      ${txt('telefono', 'Telefono', s.telefono)}
      ${txt('email', 'Email', s.email)}
      ${txt('iban', 'IBAN', s.iban)}
      ${txt('modalita_pagamento', 'Modalità di pagamento', s.modalita_pagamento)}
    </div>

    <div class="ys-actions">
      <span class="ys-msg" data-pf-msg></span>
      <button type="button" class="btn" data-pf-reset>Annulla</button>
      <button type="submit" class="btn btn-primary">Salva</button>
    </div>
  </form>`;
}

export function renderPage(displayName: string, s: AnagraficaState): string {
  return `<div class="ys-page">
    <div class="ys-crumb">Profilo ▸ Profilo personale</div>
    <h2>Profilo personale</h2>
    ${renderForm(displayName, s)}
  </div>`;
}
