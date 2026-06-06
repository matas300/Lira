// src/client/pages/clienti.ts
import { getMe } from '../lib/auth';
import { ApiError } from '../lib/api';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';
import { openModal } from '../components/modal';
import {
  listClienti, createCliente, updateCliente, removeCliente, lookupPiva,
} from '../lib/clienti-api';
import type { ClientePublic, TipoCliente } from '@shared/types';

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
}

const TIPI: TipoCliente[] = ['PF', 'PG', 'PA', 'Estero'];

// Chiavi ammesse dall'autofill (campi del form su cui mergere il risultato
// lookup). Allowlist esplicita: il valore `k` arriva dalla risposta server e
// finisce in un selettore querySelector — non fidarsi di chiavi impreviste.
const AUTOFILL_KEYS = new Set([
  'nome', 'codiceFiscale', 'indirizzo', 'cap', 'citta', 'provincia', 'pec', 'codiceSdi',
]);

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;
  let clienti: ClientePublic[] = [];
  let filter = '';
  // Handle del modal aperto: serve per chiuderlo se l'utente naviga via
  // (altrimenti backdrop + listener keydown su document restano orfani).
  let activeModalClose: (() => void) | null = null;

  function matches(c: ClientePublic): boolean {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return [c.nome, c.partitaIva, c.citta].some((f) => (f ?? '').toLowerCase().includes(q));
  }

  function rowHtml(c: ClientePublic): string {
    const star = c.isDefault ? '★ ' : '';
    const sub = [c.partitaIva, c.citta].filter(Boolean).map(esc).join(' · ');
    return `
      <li data-id="${esc(c.id)}" class="cliente-row"
          style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3);
                 background:var(--bg);border-radius:var(--radius-md);cursor:pointer;">
        <span><strong>${star}${esc(c.nome)}</strong>
          <span style="color:var(--text-muted);">${sub}</span></span>
      </li>`;
  }

  function formHtml(c: Partial<ClientePublic>): string {
    const opt = (t: TipoCliente) => `<option value="${t}"${c.tipoCliente === t ? ' selected' : ''}>${t}</option>`;
    return `
      <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
        <div class="form-row"><label>Nome *</label>
          <input class="input" name="nome" required maxlength="200" value="${esc(c.nome)}" /></div>
        <div class="form-row"><label>Tipo</label>
          <select class="input" name="tipoCliente">${TIPI.map(opt).join('')}</select></div>
        <div class="form-row"><label>Partita IVA</label>
          <div style="display:flex;gap:var(--space-2);">
            <input class="input" name="partitaIva" maxlength="11" value="${esc(c.partitaIva)}" />
            <button type="button" class="btn btn-ghost" data-autofill>Autofill</button>
          </div></div>
        <div class="form-row"><label>Codice Fiscale</label>
          <input class="input" name="codiceFiscale" maxlength="16" value="${esc(c.codiceFiscale)}" /></div>
        <div class="form-row"><label data-sdi-label>Codice SDI</label>
          <input class="input" name="codiceSdi" maxlength="7" value="${esc(c.codiceSdi)}" /></div>
        <div class="form-row"><label>PEC</label>
          <input class="input" name="pec" value="${esc(c.pec)}" /></div>
        <div class="form-row"><label>Indirizzo</label>
          <input class="input" name="indirizzo" value="${esc(c.indirizzo)}" /></div>
        <div style="display:flex;gap:var(--space-2);">
          <div class="form-row" style="flex:0 0 90px;"><label>CAP</label>
            <input class="input" name="cap" maxlength="5" value="${esc(c.cap)}" /></div>
          <div class="form-row" style="flex:1;"><label>Città</label>
            <input class="input" name="citta" value="${esc(c.citta)}" /></div>
          <div class="form-row" style="flex:0 0 70px;"><label>Prov</label>
            <input class="input" name="provincia" maxlength="2" value="${esc(c.provincia)}" /></div>
        </div>
        <div class="form-row"><label>Nazione</label>
          <input class="input" name="nazione" maxlength="2" value="${esc(c.nazione ?? 'IT')}" /></div>
        <label style="display:flex;gap:var(--space-2);align-items:center;">
          <input type="checkbox" name="isDefault"${c.isDefault ? ' checked' : ''} /> Cliente predefinito</label>
        <p class="form-error" data-error hidden></p>
        <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
          <button type="submit" class="btn btn-primary">Salva</button>
          ${c.id ? `<button type="button" class="btn btn-ghost" data-delete style="color:var(--red);">Elimina</button>` : ''}
        </div>
      </form>`;
  }

  function readForm(form: HTMLFormElement): Record<string, unknown> {
    const fd = new FormData(form);
    const str = (k: string) => { const v = String(fd.get(k) ?? '').trim(); return v === '' ? null : v; };
    return {
      nome: str('nome'),
      tipoCliente: str('tipoCliente') ?? 'PG',
      partitaIva: str('partitaIva'),
      codiceFiscale: str('codiceFiscale'),
      codiceSdi: str('codiceSdi') ?? '0000000',
      pec: str('pec'),
      indirizzo: str('indirizzo'),
      cap: str('cap'),
      citta: str('citta'),
      provincia: str('provincia'),
      nazione: str('nazione') ?? 'IT',
      isDefault: fd.get('isDefault') === 'on',
    };
  }

  function openClienteModal(existing?: ClientePublic): void {
    const handle = openModal({
      title: existing ? 'Modifica cliente' : 'Nuovo cliente',
      bodyHtml: formHtml(existing ?? {}),
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        const sdiInput = form.querySelector<HTMLInputElement>('[name="codiceSdi"]')!;
        const sdiLabel = form.querySelector<HTMLElement>('[data-sdi-label]')!;
        const tipoSel = form.querySelector<HTMLSelectElement>('[name="tipoCliente"]')!;

        const syncSdi = () => {
          const isPa = tipoSel.value === 'PA';
          sdiInput.maxLength = isPa ? 6 : 7;
          sdiLabel.textContent = isPa ? 'Codice IPA (6)' : 'Codice SDI (7)';
        };
        tipoSel.addEventListener('change', syncSdi);
        syncSdi();

        form.querySelector<HTMLButtonElement>('[data-autofill]')?.addEventListener('click', async () => {
          const piva = form.querySelector<HTMLInputElement>('[name="partitaIva"]')!.value.trim();
          errorEl.hidden = true;
          try {
            const { data } = await lookupPiva(piva);
            // merge SOLO nei campi vuoti — non sovrascrive l'input utente.
            for (const [k, v] of Object.entries(data)) {
              if (!v || !AUTOFILL_KEYS.has(k)) continue;
              const input = form.querySelector<HTMLInputElement>(`[name="${k}"]`);
              if (input && input.value.trim() === '') input.value = String(v);
            }
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Autofill non disponibile';
            errorEl.hidden = false;
          }
        });

        form.querySelector<HTMLButtonElement>('[data-delete]')?.addEventListener('click', async () => {
          if (!existing || !confirm(`Eliminare il cliente "${existing.nome}"?`)) return;
          await removeCliente(existing.id);
          close();
          await refresh();
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          const payload = readForm(form);
          try {
            // payload è un Record costruito dal form; il server ri-valida con
            // Zod (fonte di verità) e un eventuale errore di campo torna come
            // 400 VALIDATION mostrato inline. `as never` evita di duplicare il
            // tipo input Zod lato client.
            if (existing) await updateCliente(existing.id, payload);
            else await createCliente(payload as never);
            close();
            await refresh();
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Errore di salvataggio';
            errorEl.hidden = false;
          }
        });
      },
    });
    activeModalClose = handle.close;
  }

  function renderList(): void {
    const ul = container.querySelector<HTMLElement>('[data-list]');
    if (!ul) return;
    const visible = clienti.filter(matches);
    ul.innerHTML = visible.length
      ? visible.map(rowHtml).join('')
      : `<li style="color:var(--text-muted);padding:var(--space-3);">Nessun cliente.</li>`;
    ul.querySelectorAll<HTMLElement>('.cliente-row').forEach((li) => {
      li.addEventListener('click', () => {
        const c = clienti.find((x) => x.id === li.dataset.id);
        if (c) openClienteModal(c);
      });
    });
  }

  async function refresh(): Promise<void> {
    clienti = await listClienti();
    renderList();
  }

  async function render(): Promise<void> {
    const me = await getMe();
    if (!me) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    container.innerHTML = `
      <div class="app-shell">
        ${renderHeader(me, render)}
        <main class="app-main">
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">
              <h2 style="margin:0;">Clienti</h2>
              <button class="btn btn-primary" data-new>Nuovo</button>
            </div>
            <input class="input" data-search placeholder="Cerca per nome, P.IVA, città…" style="margin-bottom:var(--space-4);" />
            <ul data-list style="list-style:none;display:flex;flex-direction:column;gap:var(--space-3);"></ul>
          </div>
        </main>
        ${renderBottomNav()}
      </div>`;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);

    container.querySelector<HTMLButtonElement>('[data-new]')?.addEventListener('click', () => openClienteModal());
    container.querySelector<HTMLInputElement>('[data-search]')?.addEventListener('input', (e) => {
      filter = (e.target as HTMLInputElement).value;
      renderList();
    });
    await refresh();
  }

  render();
  return () => {
    if (cleanupHeader) cleanupHeader();
    if (activeModalClose) { activeModalClose(); activeModalClose = null; }
  };
}
