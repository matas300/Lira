// src/client/pages/fatture.ts
import { getMe } from '../lib/auth';
import { ApiError } from '../lib/api';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';
import { openModal } from '../components/modal';
import { listClienti } from '../lib/clienti-api';
import {
  listFatture, createFattura, updateFattura, removeFattura,
  inviaFattura, pagaFattura, downloadFatturaXml, createNotaCredito,
} from '../lib/fatture-api';
import type { FatturaPublic, ClientePublic, Riga } from '@shared/types';

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
}

function eur(n: number): string {
  return '€' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clienteNome(f: FatturaPublic): string {
  const s = f.clienteSnapshot as { nome?: string } | null;
  return s?.nome ?? '—';
}

const FILTERS: Array<{ key: string; label: string; match: (f: FatturaPublic) => boolean }> = [
  { key: 'tutte', label: 'Tutte', match: () => true },
  { key: 'dapagare', label: 'Da pagare', match: (f) => f.stato === 'inviata' },
  { key: 'pagate', label: 'Pagate', match: (f) => f.stato === 'pagata' },
  { key: 'bozze', label: 'Bozze', match: (f) => f.stato === 'bozza' },
];

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;
  let fatture: FatturaPublic[] = [];
  let clienti: ClientePublic[] = [];
  let filterKey = 'tutte';
  // Handle del modal aperto: chiuso se l'utente naviga via (no backdrop/listener orfani).
  let activeModalClose: (() => void) | null = null;

  function visible(): FatturaPublic[] {
    const f = FILTERS.find((x) => x.key === filterKey) ?? FILTERS[0]!;
    return fatture.filter(f.match);
  }

  function fatturatoAnnoCorrente(): number {
    const y = new Date().getUTCFullYear();
    return fatture
      .filter((f) => f.stato !== 'bozza' && f.annoProgressivo === y && f.tipoDocumento !== 'TD04')
      .reduce((s, f) => s + (f.importo || 0), 0);
  }

  function rowHtml(f: FatturaPublic): string {
    const num = f.numeroDisplay ?? '—';
    const stato = f.stato.toUpperCase();
    const xmlBtn = f.stato !== 'bozza'
      ? `<button class="btn btn-ghost" data-xml="${esc(f.id)}" title="Scarica XML">XML</button>`
      : '';
    const ncBtn = (f.tipoDocumento === 'TD01' && (f.stato === 'inviata' || f.stato === 'pagata'))
      ? `<button class="btn btn-ghost" data-nc="${esc(f.id)}" title="Crea nota di credito">NC</button>`
      : '';
    const azioni = f.stato === 'bozza'
      ? `<button class="btn btn-ghost" data-invia="${esc(f.id)}" title="Segna inviata">✉</button>
         <button class="btn btn-ghost" data-del="${esc(f.id)}" title="Elimina" style="color:var(--red);">✕</button>`
      : f.stato === 'inviata'
        ? `${xmlBtn}${ncBtn}<button class="btn btn-ghost" data-paga="${esc(f.id)}" title="Segna pagata">€</button>`
        : `${xmlBtn}${ncBtn}`;
    return `
      <li data-id="${esc(f.id)}" class="fattura-row"
          style="display:grid;grid-template-columns:80px 1fr 90px 90px auto;gap:var(--space-2);align-items:center;
                 padding:var(--space-3);background:var(--bg);border-radius:var(--radius-md);">
        <span class="fattura-open" style="cursor:pointer;font-variant-numeric:tabular-nums;">${esc(num)}</span>
        <span class="fattura-open" style="cursor:pointer;"><strong>${esc(clienteNome(f))}</strong>
          <span style="color:var(--text-muted);"> ${esc(f.dataInvioSdi ?? f.data)}</span></span>
        <span style="text-align:right;">${eur(f.importo)}</span>
        <span style="color:var(--text-muted);">${f.tipoDocumento === 'TD04' ? 'NC ' : ''}${esc(stato)}${f.ncTotaleImporto > 0 && f.stato !== 'stornata' ? ` · stornato ${eur(f.ncTotaleImporto)}` : ''}</span>
        <span style="display:flex;gap:var(--space-1);justify-content:flex-end;">${azioni}</span>
      </li>`;
  }

  function rigaInputs(r?: Partial<Riga>): string {
    return `
      <div class="riga-row" style="display:flex;gap:var(--space-2);align-items:flex-end;">
        <div class="form-row" style="flex:1;"><label>Descrizione</label>
          <input class="input" data-riga-desc value="${esc(r?.descrizione)}" /></div>
        <div class="form-row" style="flex:0 0 70px;"><label>Qtà</label>
          <input class="input" type="number" step="0.01" data-riga-qta value="${esc(r?.quantita ?? 1)}" /></div>
        <div class="form-row" style="flex:0 0 110px;"><label>Prezzo</label>
          <input class="input" type="number" step="0.01" data-riga-prezzo value="${esc(r?.prezzoUnitario ?? '')}" /></div>
        <button type="button" class="btn btn-ghost" data-riga-del style="color:var(--red);">✕</button>
      </div>`;
  }

  function formHtml(f?: FatturaPublic): string {
    const opts = clienti.map((c) => {
      const sel = f?.clienteId === c.id || (!f && c.isDefault) ? ' selected' : '';
      return `<option value="${esc(c.id)}"${sel}>${esc(c.nome)}</option>`;
    }).join('');
    const righe = (f?.righe && f.righe.length ? f.righe : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }]);
    const locked = !!f && f.stato !== 'bozza';
    return `
      <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${locked ? `<p style="color:var(--text-muted);">Fattura ${esc(f!.numeroDisplay ?? '')} ${esc(f!.stato)} — solo note modificabili.</p>` : ''}
        <div class="form-row"><label>Cliente *</label>
          <select class="input" data-cliente ${locked ? 'disabled' : ''}>${opts}</select></div>
        <div class="form-row"><label>Data *</label>
          <input class="input" type="date" data-data value="${esc(f?.data ?? new Date().toISOString().slice(0, 10))}" ${locked ? 'disabled' : ''} /></div>
        <div><label>Righe</label>
          <div data-righe style="display:flex;flex-direction:column;gap:var(--space-2);">${righe.map((r) => rigaInputs(r)).join('')}</div>
          ${locked ? '' : `<button type="button" class="btn btn-ghost" data-add-riga style="margin-top:var(--space-2);">+ Riga</button>`}</div>
        <div style="text-align:right;font-weight:600;">Totale: <span data-totale>—</span></div>
        <div class="form-row"><label>Note</label><input class="input" data-note value="${esc(f?.note)}" /></div>
        <p class="form-error" data-error hidden></p>
        <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
          <button type="submit" class="btn btn-primary">Salva</button>
          ${f && f.stato === 'bozza' ? `<button type="button" class="btn btn-ghost" data-delete style="color:var(--red);">Elimina</button>` : ''}
        </div>
      </form>`;
  }

  function readRighe(root: HTMLElement): Riga[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.riga-row')).map((row) => ({
      descrizione: (row.querySelector<HTMLInputElement>('[data-riga-desc]')!.value || '').trim(),
      quantita: Number(row.querySelector<HTMLInputElement>('[data-riga-qta]')!.value) || 0,
      prezzoUnitario: Number(row.querySelector<HTMLInputElement>('[data-riga-prezzo]')!.value) || 0,
    }));
  }

  function recalcTotale(root: HTMLElement): void {
    const tot = readRighe(root).reduce((s, r) => s + r.quantita * r.prezzoUnitario, 0);
    const el = root.querySelector<HTMLElement>('[data-totale]');
    if (el) el.textContent = eur(tot);
  }

  function openFatturaModal(existing?: FatturaPublic): void {
    const handle = openModal({
      title: existing ? (existing.numeroDisplay ?? 'Bozza') : 'Nuova fattura',
      bodyHtml: formHtml(existing),
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        const righeEl = root.querySelector<HTMLElement>('[data-righe]')!;
        const locked = !!existing && existing.stato !== 'bozza';

        const wireRigaRow = (row: HTMLElement) => {
          row.querySelector<HTMLButtonElement>('[data-riga-del]')?.addEventListener('click', () => {
            if (righeEl.querySelectorAll('.riga-row').length > 1) { row.remove(); recalcTotale(root); }
          });
          row.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.addEventListener('input', () => recalcTotale(root)));
        };
        righeEl.querySelectorAll<HTMLElement>('.riga-row').forEach(wireRigaRow);
        root.querySelector<HTMLButtonElement>('[data-add-riga]')?.addEventListener('click', () => {
          righeEl.insertAdjacentHTML('beforeend', rigaInputs());
          wireRigaRow(righeEl.lastElementChild as HTMLElement);
        });
        recalcTotale(root);

        root.querySelector<HTMLButtonElement>('[data-delete]')?.addEventListener('click', async () => {
          if (!existing || !confirm('Eliminare questa bozza?')) return;
          await removeFattura(existing.id); close(); await refresh();
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          try {
            if (locked) {
              await updateFattura(existing!.id, { note: root.querySelector<HTMLInputElement>('[data-note]')!.value.trim() || null });
            } else {
              const payload = {
                clienteId: root.querySelector<HTMLSelectElement>('[data-cliente]')!.value,
                data: root.querySelector<HTMLInputElement>('[data-data]')!.value,
                righe: readRighe(root),
                note: root.querySelector<HTMLInputElement>('[data-note]')!.value.trim() || null,
              };
              if (existing) await updateFattura(existing.id, payload as never);
              else await createFattura(payload as never);
            }
            close(); await refresh();
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Errore di salvataggio';
            errorEl.hidden = false;
          }
        });
      },
    });
    activeModalClose = handle.close;
  }

  function openNotaCreditoModal(orig: FatturaPublic): void {
    const righeInit = orig.righe.length ? orig.righe : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }];
    const handle = openModal({
      title: `Nota di credito su ${orig.numeroDisplay ?? ''}`,
      bodyHtml: `
        <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
          <p style="color:var(--text-muted);">Storno di ${esc(orig.numeroDisplay ?? '')} — ${esc(clienteNome(orig))}. Riduci gli importi per uno storno parziale.</p>
          <div class="form-row"><label>Data *</label>
            <input class="input" type="date" data-data value="${esc(orig.data)}" /></div>
          <div><label>Righe</label>
            <div data-righe style="display:flex;flex-direction:column;gap:var(--space-2);">${righeInit.map((r) => rigaInputs(r)).join('')}</div></div>
          <div style="text-align:right;font-weight:600;">Totale storno: <span data-totale>—</span></div>
          <p class="form-error" data-error hidden></p>
          <button type="submit" class="btn btn-primary">Crea nota di credito</button>
        </form>`,
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-form]')!;
        const errorEl = root.querySelector<HTMLElement>('[data-error]')!;
        root.querySelectorAll<HTMLInputElement>('input').forEach((i) => i.addEventListener('input', () => recalcTotale(root)));
        recalcTotale(root);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEl.hidden = true;
          try {
            await createNotaCredito(orig.id, {
              data: root.querySelector<HTMLInputElement>('[data-data]')!.value,
              righe: readRighe(root),
            } as never);
            close(); await refresh();
          } catch (err) {
            errorEl.textContent = err instanceof ApiError ? err.message : 'Errore creazione NC';
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
    const rows = visible();
    ul.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : `<li style="color:var(--text-muted);padding:var(--space-3);">Nessuna fattura.</li>`;
    ul.querySelectorAll<HTMLElement>('.fattura-open').forEach((el) => {
      el.addEventListener('click', () => {
        const li = el.closest<HTMLElement>('.fattura-row')!;
        const f = fatture.find((x) => x.id === li.dataset.id);
        if (f) openFatturaModal(f);
      });
    });
    ul.querySelectorAll<HTMLButtonElement>('[data-invia]').forEach((b) => b.addEventListener('click', async () => {
      try { await inviaFattura(b.dataset.invia!); await refresh(); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore invio'); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-paga]').forEach((b) => b.addEventListener('click', async () => {
      const d = prompt('Data incasso (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
      if (!d) return;
      try { await pagaFattura(b.dataset.paga!, d); await refresh(); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore'); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Eliminare questa bozza?')) return;
      try { await removeFattura(b.dataset.del!); await refresh(); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore'); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-xml]').forEach((b) => b.addEventListener('click', async () => {
      try { await downloadFatturaXml(b.dataset.xml!); }
      catch (err) { alert(err instanceof ApiError ? err.message : 'Errore generazione XML'); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-nc]').forEach((b) => b.addEventListener('click', () => {
      const f = fatture.find((x) => x.id === b.dataset.nc);
      if (f) openNotaCreditoModal(f);
    }));
  }

  function renderMeta(): void {
    const bar = container.querySelector<HTMLElement>('[data-fatturato]');
    if (!bar) return;
    const tot = fatturatoAnnoCorrente();
    const pct = Math.min(100, Math.round((tot / 85000) * 100));
    bar.innerHTML = `Fatturato ${new Date().getUTCFullYear()}: ${eur(tot)} / €85.000
      <div style="height:6px;background:var(--bg);border-radius:4px;margin-top:4px;">
        <div style="height:100%;width:${pct}%;background:var(--color-primary);border-radius:4px;"></div></div>`;
  }

  async function refresh(): Promise<void> {
    fatture = await listFatture();
    renderList(); renderMeta();
  }

  async function render(): Promise<void> {
    const me = await getMe();
    if (!me) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    clienti = await listClienti();
    const chips = FILTERS.map((f) =>
      `<button class="btn btn-ghost" data-filter="${f.key}">${f.label}</button>`).join('');
    container.innerHTML = `
      <div class="app-shell">
        ${renderHeader(me, render)}
        <main class="app-main">
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
              <h2 style="margin:0;">Fatture</h2>
              <button class="btn btn-primary" data-new${clienti.length ? '' : ' disabled title="Crea prima un cliente"'}>Nuova</button>
            </div>
            <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3);">${chips}</div>
            <div data-fatturato style="margin-bottom:var(--space-4);color:var(--text-muted);"></div>
            <ul data-list style="list-style:none;display:flex;flex-direction:column;gap:var(--space-2);"></ul>
          </div>
        </main>
        ${renderBottomNav()}
      </div>`;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);

    container.querySelector<HTMLButtonElement>('[data-new]')?.addEventListener('click', () => openFatturaModal());
    container.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      filterKey = b.dataset.filter!; renderList();
    }));
    await refresh();
  }

  render();
  return () => {
    if (cleanupHeader) cleanupHeader();
    if (activeModalClose) { activeModalClose(); activeModalClose = null; }
  };
}
