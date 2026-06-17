// src/client/pages/profilo-personale.ts
//
// Pagina "Profilo personale" (/profilo-personale): editor dei dati anagrafici
// del profilo attivo (profiles.anagrafica) + displayName. Raggiunta dal menu
// profilo. Render puri (testabili) + mount con fetch/save. Backend:
// GET/PATCH /api/profiles/active.

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import {
  anagraficaFromResponse, anagraficaToBody, copyResidenzaToDomicilio,
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

// ── mount ──

interface ActiveProfileResponse {
  profile: { displayName: string; anagrafica: Record<string, unknown> };
}

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/profilo-personale',
    render: async ({ main }) => {
      main.innerHTML = `<div class="card ys-note">Carico il profilo…</div>`;

      let displayName = '';
      let state: AnagraficaState;
      try {
        const resp = await api.get<ActiveProfileResponse>('/api/profiles/active');
        displayName = resp.profile.displayName;
        state = anagraficaFromResponse(resp.profile.anagrafica);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare il profilo. Riprova.';
        main.innerHTML = `<div class="card ys-note ys-note-warn">${esc(msg)}</div>`;
        return;
      }

      function validateAll(): void {
        const set = (field: string, msg: string | null) => {
          const el = main.querySelector<HTMLElement>(`[data-err="${field}"]`);
          if (el) el.textContent = msg ?? '';
        };
        set('cf', fieldError('cf', state.cf));
        set('email', fieldError('email', state.email));
        set('residenza.cap', fieldError('cap', state.residenza.cap));
        set('residenza.provincia', fieldError('provincia', state.residenza.provincia));
        set('domicilio_fiscale.cap', fieldError('cap', state.domicilio_fiscale.cap));
        set('domicilio_fiscale.provincia', fieldError('provincia', state.domicilio_fiscale.provincia));
        set('prov_nascita', fieldError('provincia', state.prov_nascita));
      }

      function render(): void {
        main.innerHTML = renderPage(displayName, state);
        const form = main.querySelector<HTMLFormElement>('[data-pf-form]')!;
        const msgEl = main.querySelector<HTMLElement>('[data-pf-msg]')!;

        // bind di tutti gli input text (top-level e annidati via "a.b")
        main.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((el) => {
          const field = el.dataset['field']!;
          el.addEventListener('input', () => {
            if (field === 'displayName') { displayName = el.value; return; }
            if (field.includes('.')) {
              const [grp, key] = field.split('.') as ['residenza' | 'domicilio_fiscale', keyof AnagraficaState['residenza']];
              state[grp][key] = el.value;
            } else {
              (state as unknown as Record<string, string>)[field] = el.value;
            }
            validateAll();
          });
        });

        // "domicilio = residenza"
        const same = main.querySelector<HTMLInputElement>('[data-same-domicilio]');
        const wrap = main.querySelector<HTMLElement>('[data-domicilio-wrap]');
        same?.addEventListener('change', () => {
          if (same.checked) {
            state = copyResidenzaToDomicilio(state);
            if (wrap) wrap.style.display = 'none';
            render();
          } else if (wrap) {
            wrap.style.display = '';
          }
        });

        main.querySelector<HTMLButtonElement>('[data-pf-reset]')?.addEventListener('click', () => render());

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          msgEl.textContent = 'Salvataggio…';
          msgEl.className = 'ys-msg';
          try {
            const resp = await api.patch<ActiveProfileResponse>('/api/profiles/active', {
              displayName,
              anagrafica: anagraficaToBody(state),
            });
            displayName = resp.profile.displayName;
            state = anagraficaFromResponse(resp.profile.anagrafica);
            render();
            const m = main.querySelector<HTMLElement>('[data-pf-msg]');
            if (m) { m.textContent = 'Salvato ✓'; m.className = 'ys-msg is-ok'; }
          } catch (err) {
            const text = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
            msgEl.textContent = text;
            msgEl.className = 'ys-msg is-err';
          }
        });

        validateAll();
      }

      render();
    },
  });
}
