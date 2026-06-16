// src/client/pages/fatture.ts
import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { openModal, confirmModal, alertModal, promptDateModal } from '../components/modal';
import { listClienti } from '../lib/clienti-api';
import {
  listFatture, createFattura, updateFattura, removeFattura,
  inviaFattura, pagaFattura, downloadFatturaXml, openFatturaPdf, createNotaCredito, importXmlFatture,
} from '../lib/fatture-api';
import { parseFatturaXml, ImportParseError } from '../lib/parse-fattura-xml';
import { buildImportItem } from '@shared/import-fattura';
import type { FatturaPublic, ClientePublic, Riga, ImportFatturaInput, ImportReport } from '@shared/types';
import { getYear } from '../lib/year';
import { monthlyWorkStats } from '../lib/calendar-stats';

// Draft prefill per nuova fattura da-calendario (non ha id/stato: è sempre "nuova").
interface NewFatturaDraft {
  clienteId?: string;
  data?: string;
  righe?: Riga[];
  note?: string | null;
}

const MESI_NOMI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const LIMITE_FORFETTARIO_FALLBACK = 85000;

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

// ── Report import XML ──
// Il render è tollerante a campi extra (warning/errori per-item in arrivo da
// uno slice parallelo): le liste sconosciute vengono formattate genericamente.
function fmtReportItem(it: unknown): string {
  if (typeof it === 'string') return esc(it);
  if (it && typeof it === 'object') {
    const o = it as Record<string, unknown>;
    const num = o.numero ?? o.file ?? o.id ?? '';
    const msg = o.motivo ?? o.messaggio ?? o.message ?? o.warning ?? o.errore ?? '';
    if (num !== '' || msg !== '') return `${esc(num)}${num !== '' && msg !== '' ? ': ' : ''}${esc(msg)}`;
    return esc(JSON.stringify(it));
  }
  return esc(String(it));
}

function reportListHtml(label: string, items: unknown[], cls: string): string {
  if (!items.length) return '';
  return `
    <p style="margin-top:var(--space-3);font-weight:600;">${esc(label)}</p>
    <ul>${items.map((it) => `<li class="${cls}">• ${fmtReportItem(it)}</li>`).join('')}</ul>`;
}

function importReportHtml(rep: ImportReport, erroriParse: string[]): string {
  const extra = rep as unknown as Record<string, unknown>;
  const warnings = Array.isArray(extra.warnings) ? extra.warnings : [];
  const errori = Array.isArray(extra.errori) ? extra.errori : [];
  return `
    <div class="import-report">
      <p>Importate: <strong>${Number(rep.importate) || 0}</strong>
         · Clienti creati: <strong>${Number(rep.clientiCreati) || 0}</strong>
         · Saltate: <strong>${Array.isArray(rep.saltate) ? rep.saltate.length : 0}</strong></p>
      ${reportListHtml('Saltate', Array.isArray(rep.saltate) ? rep.saltate : [], 'warn')}
      ${reportListHtml('Warning', warnings, 'warn')}
      ${reportListHtml('Errori', errori, 'err')}
      ${reportListHtml('File non parsati', erroriParse, 'err')}
    </div>`;
}

export function mount(container: HTMLElement): () => void {
  let fatture: FatturaPublic[] = [];
  let clienti: ClientePublic[] = [];
  let filterKey = 'tutte';
  let limiteForfettario = LIMITE_FORFETTARIO_FALLBACK;
  // Handle del modal aperto: chiuso se l'utente naviga via (no backdrop/listener orfani).
  let activeModalClose: (() => void) | null = null;

  function visible(): FatturaPublic[] {
    const f = FILTERS.find((x) => x.key === filterKey) ?? FILTERS[0]!;
    return fatture.filter(f.match);
  }

  // Fatturato anno corrente per la barra: TD01 non bozza/stornata, al netto
  // degli storni parziali (importo − ncTotaleImporto). Le NC (TD04) non
  // contano come fatturato proprio.
  function fatturatoAnnoCorrente(): number {
    const y = new Date().getUTCFullYear();
    return fatture
      .filter((f) =>
        f.stato !== 'bozza' && f.stato !== 'stornata'
        && f.annoProgressivo === y && f.tipoDocumento !== 'TD04')
      .reduce((s, f) => s + Math.max(0, (f.importo || 0) - (f.ncTotaleImporto || 0)), 0);
  }

  function badgeHtml(f: FatturaPublic): string {
    return `<span class="badge-stato ${esc(f.stato)}">${esc(f.stato.toUpperCase())}</span>`;
  }

  function rowHtml(f: FatturaPublic): string {
    const num = f.numeroDisplay ?? '—';
    const isNc = f.tipoDocumento === 'TD04';
    // PDF disponibile su OGNI stato, bozza inclusa (preview watermarkata, 5D).
    const pdfBtn = `<button class="btn btn-ghost" data-pdf="${esc(f.id)}" title="Apri PDF">PDF</button>`;
    const xmlBtn = f.stato !== 'bozza'
      ? `<button class="btn btn-ghost" data-xml="${esc(f.id)}" title="Scarica XML">XML</button>`
      : '';
    const ncBtn = (f.tipoDocumento === 'TD01' && (f.stato === 'inviata' || f.stato === 'pagata'))
      ? `<button class="btn btn-ghost" data-nc="${esc(f.id)}" title="Crea nota di credito">NC</button>`
      : '';
    // Le NC (TD04) non sono "pagabili": niente bottone € (il server lo rifiuta comunque).
    const pagaBtn = (!isNc && f.stato === 'inviata')
      ? `<button class="btn btn-ghost" data-paga="${esc(f.id)}" title="Segna pagata">€</button>`
      : '';
    const azioni = f.stato === 'bozza'
      ? `${pdfBtn}
         <button class="btn btn-ghost" data-invia="${esc(f.id)}" title="Segna inviata">✉</button>
         <button class="btn btn-danger" data-del="${esc(f.id)}" title="Elimina">✕</button>`
      : `${pdfBtn}${xmlBtn}${ncBtn}${pagaBtn}`;
    const stornoInfo = f.ncTotaleImporto > 0 && f.stato !== 'stornata'
      ? `<span style="color:var(--color-text-muted);font-size:.78rem;"> · stornato ${eur(f.ncTotaleImporto)}</span>`
      : '';
    return `
      <li data-id="${esc(f.id)}" class="fattura-row">
        <span class="numero fattura-open">${esc(num)}</span>
        <span class="fattura-open" style="cursor:pointer;"><strong>${esc(clienteNome(f))}</strong>
          <span style="color:var(--color-text-muted);"> ${esc(f.dataInvioSdi ?? f.data)}</span></span>
        <span class="importo">${eur(f.importo)}</span>
        <span>${isNc ? '<span style="color:var(--color-text-muted);font-size:.78rem;">NC </span>' : ''}${badgeHtml(f)}${stornoInfo}</span>
        <span class="azioni">${azioni}</span>
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
        <button type="button" class="btn btn-danger" data-riga-del title="Rimuovi riga">✕</button>
      </div>`;
  }

  function formHtml(f?: FatturaPublic, draft?: NewFatturaDraft): string {
    // draft è usato solo quando f è undefined (nuova fattura prefill da-calendario).
    const prefill = !f ? draft : undefined;
    const opts = clienti.map((c) => {
      const sel = f?.clienteId === c.id
        || prefill?.clienteId === c.id
        || (!f && !prefill?.clienteId && c.isDefault) ? ' selected' : '';
      return `<option value="${esc(c.id)}"${sel}>${esc(c.nome)}</option>`;
    }).join('');
    const righe = f?.righe && f.righe.length
      ? f.righe
      : prefill?.righe && prefill.righe.length
        ? prefill.righe
        : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }];
    const dataVal = f?.data ?? prefill?.data ?? new Date().toISOString().slice(0, 10);
    const locked = !!f && f.stato !== 'bozza';
    return `
      <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${locked ? `<p style="color:var(--color-text-muted);">Fattura ${esc(f!.numeroDisplay ?? '')} ${esc(f!.stato)} — solo note modificabili.</p>` : ''}
        <div class="form-row"><label>Cliente *</label>
          <select class="input" data-cliente ${locked ? 'disabled' : ''}>${opts}</select></div>
        <div class="form-row"><label>Data *</label>
          <input class="input" type="date" data-data value="${esc(dataVal)}" ${locked ? 'disabled' : ''} /></div>
        <div><label>Righe</label>
          <div data-righe style="display:flex;flex-direction:column;gap:var(--space-2);">${righe.map((r) => rigaInputs(r)).join('')}</div>
          ${locked ? '' : `<button type="button" class="btn btn-ghost" data-add-riga style="margin-top:var(--space-2);">+ Riga</button>`}</div>
        <div style="text-align:right;font-weight:600;">Totale: <span data-totale>—</span></div>
        <div class="form-row"><label>Note</label><input class="input" data-note value="${esc(f?.note ?? prefill?.note)}" /></div>
        <p class="form-error" data-error hidden></p>
        <div style="display:flex;gap:var(--space-2);justify-content:space-between;">
          <button type="submit" class="btn btn-primary">Salva</button>
          ${f && f.stato === 'bozza' ? `<button type="button" class="btn btn-danger" data-delete>Elimina</button>` : ''}
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

  function openFatturaModal(existing?: FatturaPublic, draft?: NewFatturaDraft): void {
    const handle = openModal({
      title: existing ? (existing.numeroDisplay ?? 'Bozza') : 'Nuova fattura',
      bodyHtml: formHtml(existing, draft),
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
          if (!existing) return;
          const ok = await confirmModal('Eliminare questa bozza?', {
            title: 'Elimina bozza', confirmLabel: 'Elimina', danger: true,
          });
          if (!ok) return;
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

  // ── Flusso "Da calendario" ───────────────────────────────────────────────────

  function lastDayOfMonth(year: number, month: number): string {
    const d = new Date(year, month, 0); // giorno 0 del mese successivo = ultimo del mese
    return d.toISOString().slice(0, 10);
  }

  async function openDaCalendarioFlow(): Promise<void> {
    const year = getYear();
    const defaultCliente = clienti.find((c) => c.isDefault);

    // 1. Carica calendario e year-settings in parallelo
    let overrides: Map<string, string>;
    let tariffaGiornaliera: number | null = null;
    let yearSettingsExist = false;
    let currentSettings: Record<string, unknown> | null = null;

    try {
      const [calRes, settingsRes] = await Promise.allSettled([
        api.get<{ entries: Array<{ month: number; day: number; activityCode: string }> }>(`/api/calendario/${year}`),
        api.get<{ yearSettings: Record<string, unknown> }>(`/api/year-settings/${year}`),
      ]);

      const entries = calRes.status === 'fulfilled' ? calRes.value.entries : [];
      overrides = new Map(entries.map((e) => [`${e.month}-${e.day}`, e.activityCode]));

      if (settingsRes.status === 'fulfilled') {
        const ys = settingsRes.value.yearSettings;
        const t = ys?.tariffaGiornaliera;
        if (typeof t === 'number' && t > 0) tariffaGiornaliera = t;
        yearSettingsExist = true;
        currentSettings = ys as Record<string, unknown>;
      }
    } catch {
      overrides = new Map();
    }

    const stats = monthlyWorkStats(year, overrides);

    // 2. Picker modal
    await new Promise<void>((resolvePicker) => {
      let pickerClosed = false;

      function computeImportoRiga(gg: number, mezze: number, tariffa: number): number {
        return gg * tariffa + mezze * (tariffa / 2);
      }

      function buildPickerBody(tariffa: number | null): string {
        const tarVal = tariffa != null ? String(tariffa) : '';
        const rows = stats.map((s) => {
          const nomeMese = MESI_NOMI[s.month - 1] ?? `Mese ${s.month}`;
          const hasWork = s.worked > 0 || s.half > 0;
          const importo = tariffa != null && hasWork
            ? computeImportoRiga(s.worked, s.half, tariffa)
            : null;
          const label = [
            s.worked > 0 ? `${s.worked} gg` : '',
            s.half > 0 ? `${s.half} mezze` : '',
          ].filter(Boolean).join(' + ');
          const importoStr = importo != null ? ` · ${eur(importo)}` : '';
          return `
            <button type="button" class="cal-month-picker-btn${hasWork ? '' : ' disabled'}"
              data-month="${s.month}" ${hasWork ? '' : 'disabled aria-disabled="true"'}>
              <span class="cal-month-name">${esc(nomeMese)}</span>
              <span class="cal-month-detail">${hasWork ? esc(label) + importoStr : 'Nessun giorno'}</span>
            </button>`;
        }).join('');

        return `
          <div class="cal-picker-modal">
            <div class="form-row cal-picker-tariffa-row">
              <label>Tariffa giornaliera (€) *</label>
              <input class="input" type="number" min="0" step="0.01" data-tariffa
                value="${esc(tarVal)}" placeholder="es. 300" />
            </div>
            <p class="form-error" data-picker-error hidden></p>
            <div class="cal-month-grid">${rows}</div>
          </div>`;
      }

      let pickerClose: (() => void) | null = null;

      const pickerHandle = openModal({
        title: `Da calendario ${year}`,
        bodyHtml: buildPickerBody(tariffaGiornaliera),
        onMount: (root, close) => {
          pickerClose = close;

          function getPickerTariffa(): number | null {
            const v = root.querySelector<HTMLInputElement>('[data-tariffa]')!.value.trim();
            if (!v) return null;
            const n = Number(v);
            return Number.isFinite(n) && n > 0 ? n : null;
          }

          function updateMonthAmounts(): void {
            const tariffa = getPickerTariffa();
            root.querySelectorAll<HTMLButtonElement>('[data-month]').forEach((btn) => {
              const m = Number(btn.dataset.month);
              const s = stats.find((x) => x.month === m);
              if (!s) return;
              const hasWork = s.worked > 0 || s.half > 0;
              const detail = btn.querySelector<HTMLElement>('.cal-month-detail');
              if (!detail) return;
              const label = [
                s.worked > 0 ? `${s.worked} gg` : '',
                s.half > 0 ? `${s.half} mezze` : '',
              ].filter(Boolean).join(' + ');
              if (hasWork && tariffa != null) {
                detail.textContent = `${label} · ${eur(computeImportoRiga(s.worked, s.half, tariffa))}`;
              } else if (hasWork) {
                detail.textContent = label;
              }
            });
          }

          root.querySelector<HTMLInputElement>('[data-tariffa]')
            ?.addEventListener('input', updateMonthAmounts);

          root.querySelectorAll<HTMLButtonElement>('[data-month]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const tariffa = getPickerTariffa();
              const errorEl = root.querySelector<HTMLElement>('[data-picker-error]')!;
              if (!tariffa) {
                errorEl.textContent = 'Inserisci una tariffa giornaliera valida.';
                errorEl.hidden = false;
                root.querySelector<HTMLInputElement>('[data-tariffa]')?.focus();
                return;
              }
              errorEl.hidden = true;

              const month = Number(btn.dataset.month);
              const s = stats.find((x) => x.month === month)!;
              const nomeMese = MESI_NOMI[month - 1] ?? `Mese ${month}`;

              // Costruisci le righe
              const righe: Riga[] = [];
              if (s.worked > 0) {
                righe.push({
                  descrizione: `Consulenza ${nomeMese} ${year} — giornate intere`,
                  quantita: s.worked,
                  prezzoUnitario: tariffa,
                });
              }
              if (s.half > 0) {
                righe.push({
                  descrizione: `Consulenza ${nomeMese} ${year} — mezze giornate`,
                  quantita: s.half,
                  prezzoUnitario: tariffa / 2,
                });
              }

              const draft: NewFatturaDraft = {
                clienteId: defaultCliente?.id,
                data: lastDayOfMonth(year, month),
                righe,
              };

              // Persisti la tariffa in year-settings se esistono
              if (yearSettingsExist && currentSettings != null) {
                try {
                  const merged = { ...currentSettings, tariffaGiornaliera: tariffa };
                  await api.put(`/api/year-settings/${year}`, merged);
                } catch {
                  // Non bloccante: tariffa già mostrata nel picker
                }
              }

              // Chiudi picker e apri modal fattura
              pickerClosed = true;
              close();
              openFatturaModal(undefined, draft);
            });
          });
        },
        onClose: () => {
          if (!pickerClosed) resolvePicker();
          else resolvePicker();
        },
      });
      activeModalClose = pickerHandle.close;
      void pickerClose; // usato nelle callback interne
    });
  }

  function openNotaCreditoModal(orig: FatturaPublic): void {
    const righeInit = orig.righe.length ? orig.righe : [{ descrizione: '', quantita: 1, prezzoUnitario: 0 }];
    // La data della NC è precompilata con OGGI (la data della fattura
    // originale invitava alla retrodatazione).
    const oggi = new Date().toISOString().slice(0, 10);
    const handle = openModal({
      title: `Nota di credito su ${orig.numeroDisplay ?? ''}`,
      bodyHtml: `
        <form data-form style="display:flex;flex-direction:column;gap:var(--space-3);">
          <p style="color:var(--color-text-muted);">Storno di ${esc(orig.numeroDisplay ?? '')} — ${esc(clienteNome(orig))}. Riduci gli importi per uno storno parziale.</p>
          <div class="form-row"><label>Data *</label>
            <input class="input" type="date" data-data value="${esc(oggi)}" /></div>
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
      : `<li class="table-empty">Nessuna fattura.</li>`;
    ul.querySelectorAll<HTMLElement>('.fattura-open').forEach((el) => {
      el.addEventListener('click', () => {
        const li = el.closest<HTMLElement>('.fattura-row')!;
        const f = fatture.find((x) => x.id === li.dataset.id);
        if (f) openFatturaModal(f);
      });
    });
    ul.querySelectorAll<HTMLButtonElement>('[data-invia]').forEach((b) => b.addEventListener('click', async () => {
      try { await inviaFattura(b.dataset.invia!); await refresh(); }
      catch (err) { await alertModal('Errore invio', `<p>${esc(err instanceof ApiError ? err.message : 'Errore invio')}</p>`); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-paga]').forEach((b) => b.addEventListener('click', async () => {
      const d = await promptDateModal('Segna pagata', 'Data incasso', new Date().toISOString().slice(0, 10));
      if (!d) return;
      try { await pagaFattura(b.dataset.paga!, d); await refresh(); }
      catch (err) { await alertModal('Errore', `<p>${esc(err instanceof ApiError ? err.message : 'Errore')}</p>`); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmModal('Eliminare questa bozza?', {
        title: 'Elimina bozza', confirmLabel: 'Elimina', danger: true,
      });
      if (!ok) return;
      try { await removeFattura(b.dataset.del!); await refresh(); }
      catch (err) { await alertModal('Errore', `<p>${esc(err instanceof ApiError ? err.message : 'Errore')}</p>`); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-xml]').forEach((b) => b.addEventListener('click', async () => {
      try { await downloadFatturaXml(b.dataset.xml!); }
      catch (err) { await alertModal('Errore generazione XML', `<p>${esc(err instanceof ApiError ? err.message : 'Errore generazione XML')}</p>`); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-pdf]').forEach((b) => b.addEventListener('click', async () => {
      try { await openFatturaPdf(b.dataset.pdf!); }
      catch (err) { await alertModal('Errore generazione PDF', `<p>${esc(err instanceof ApiError ? err.message : 'Errore generazione PDF')}</p>`); }
    }));
    ul.querySelectorAll<HTMLButtonElement>('[data-nc]').forEach((b) => b.addEventListener('click', () => {
      const f = fatture.find((x) => x.id === b.dataset.nc);
      if (f) openNotaCreditoModal(f);
    }));
  }

  function renderMeta(): void {
    const box = container.querySelector<HTMLElement>('[data-fatturato]');
    if (!box) return;
    const anno = new Date().getUTCFullYear();
    const tot = fatturatoAnnoCorrente();
    const pct = Math.min(100, Math.round((tot / limiteForfettario) * 100));
    const fillColor = pct >= 100 ? 'var(--color-error)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-primary)';
    box.innerHTML = `
      <span style="color:var(--color-text-muted);">Fatturato ${anno}: ${eur(tot)} / ${eur(limiteForfettario)}</span>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%;background:${fillColor};"></div>
        <span class="progress-text">${pct}%</span>
      </div>`;
  }

  // Soglia forfettario dai year-settings (fallback 85.000 se assenti).
  async function loadLimite(): Promise<void> {
    const anno = new Date().getUTCFullYear();
    try {
      const res = await api.get<{ yearSettings: { limiteForfettario?: number | null } }>(`/api/year-settings/${anno}`);
      const lim = res.yearSettings?.limiteForfettario;
      if (typeof lim === 'number' && lim > 0) limiteForfettario = lim;
    } catch {
      limiteForfettario = LIMITE_FORFETTARIO_FALLBACK;
    }
  }

  async function refresh(): Promise<void> {
    fatture = await listFatture();
    renderList(); renderMeta();
  }

  function renderChips(): void {
    container.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === filterKey);
    });
  }

  return mountPage({
    container,
    route: '/fatture',
    render: async ({ main }) => {
      clienti = await listClienti();
      const chips = FILTERS.map((f) =>
        `<button class="filter-chip${f.key === filterKey ? ' active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('');
      main.innerHTML = `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
            <h2 style="margin:0;">Fatture</h2>
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn-ghost" data-import-xml>Importa XML</button>
              <button class="btn btn-ghost" data-da-calendario${clienti.length ? '' : ' disabled title="Crea prima un cliente"'}>Da calendario</button>
              <button class="btn btn-primary" data-new${clienti.length ? '' : ' disabled title="Crea prima un cliente"'}>Nuova</button>
            </div>
            <input type="file" accept=".xml,text/xml,application/xml" multiple data-xml-input hidden />
          </div>
          <div class="filter-chips" style="margin-bottom:var(--space-3);">${chips}</div>
          <div data-fatturato style="margin-bottom:var(--space-4);"></div>
          <div class="fatture-table">
            <div class="fatture-table-header">
              <span>Numero</span><span>Cliente</span><span style="text-align:right;">Importo</span><span>Stato</span><span></span>
            </div>
            <ul data-list></ul>
          </div>
        </div>`;

      main.querySelector<HTMLButtonElement>('[data-new]')?.addEventListener('click', () => openFatturaModal());
      main.querySelector<HTMLButtonElement>('[data-da-calendario]')?.addEventListener('click', () => {
        openDaCalendarioFlow().catch((err: unknown) => {
          console.error('Da calendario error:', err);
        });
      });
      main.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
        filterKey = b.dataset.filter!; renderChips(); renderList();
      }));

      const fileInput = main.querySelector<HTMLInputElement>('[data-xml-input]');
      main.querySelector<HTMLButtonElement>('[data-import-xml]')?.addEventListener('click', () => fileInput?.click());
      fileInput?.addEventListener('change', async () => {
        const files = Array.from(fileInput.files ?? []);
        fileInput.value = '';
        if (!files.length) return;
        const items: ImportFatturaInput[] = [];
        const erroriParse: string[] = [];
        for (const file of files) {
          try {
            items.push(buildImportItem(parseFatturaXml(await file.text())));
          } catch (err) {
            erroriParse.push(`${file.name}: ${err instanceof ImportParseError ? err.message : 'XML non valido'}`);
          }
        }
        if (!items.length) {
          await alertModal('Import XML', `
            <div class="import-report">
              <p>Nessun XML valido.</p>
              ${reportListHtml('File non parsati', erroriParse, 'err')}
            </div>`);
          return;
        }
        try {
          const rep = await importXmlFatture(items);
          await refresh();
          await alertModal('Report import XML', importReportHtml(rep, erroriParse));
        } catch (err) {
          await alertModal('Errore import', `<p>${esc(err instanceof ApiError ? err.message : 'Errore import')}</p>`);
        }
      });

      await loadLimite();
      await refresh();
    },
    onUnmount: () => {
      if (activeModalClose) { activeModalClose(); activeModalClose = null; }
    },
  });
}
