// src/client/pages/calendario.ts
//
// Pagina "Calendario" (/calendario): griglia 12 mesi con codici attività.
//
// Funzioni pure (Task 4): effectiveCode, renderMonth, renderLegend, renderCalendario.
// Mount + picker (Task 5): fetch GET + click → popup → PUT/DELETE + rerender.
//
// Solo override (≠ default) vivono nel DB; il default è calcolato da getDefaultActivity.
// Port fedele della griglia CalcoliVari app-calendar.js (offset lunedì-based,
// classi act-*, summary conteggi, badge).

import { api, ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';
import { getYear } from '../lib/year';
import { getDefaultActivity, isItalianHoliday as _isItalianHoliday } from '../lib/calendar-defaults';

// ── Tipi ──

type ActivityCode = '8' | 'M' | 'F' | 'FS' | 'Malattia' | 'Donazione' | 'WE';

interface CalendarEntry {
  month: number;
  day: number;
  activityCode: string;
}

interface CalendarioResponse {
  year: number;
  entries: CalendarEntry[];
}

// ── Costanti ──

const MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const ACTIVITY_INFO: Record<ActivityCode, { label: string; cssColor: string }> = {
  '8':        { label: 'Lavoro',       cssColor: 'var(--color-cal-lavoro)' },
  'M':        { label: '1/2 giornata', cssColor: 'var(--color-cal-mezzagiornata)' },
  'F':        { label: 'Ferie',        cssColor: 'var(--color-cal-ferie)' },
  'FS':       { label: 'Festivo',      cssColor: 'var(--color-cal-festivo)' },
  'Malattia': { label: 'Malattia',     cssColor: 'var(--color-cal-malattia)' },
  'Donazione':{ label: 'Donazione',    cssColor: 'var(--color-cal-donazione)' },
  'WE':       { label: 'Weekend',      cssColor: 'rgba(255,255,255,.12)' },
};

const ALL_CODES: ActivityCode[] = ['8', 'M', 'F', 'FS', 'Malattia', 'Donazione', 'WE'];

// ── Helpers ──

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Costruisce la chiave stringa per entriesMap: "month-day" */
function mapKey(month: number, day: number): string {
  return `${month}-${day}`;
}

// ─────────────────────────── effectiveCode ───────────────────────────

/**
 * Codice effettivo per un giorno: usa l'override dalla map se presente,
 * altrimenti calcola il default (WE/FS/8).
 */
export function effectiveCode(
  entriesMap: Map<string, string>,
  year: number,
  month: number,
  day: number,
): string {
  const key = mapKey(month, day);
  const override = entriesMap.get(key);
  if (override !== undefined) return override;
  return getDefaultActivity(year, month, day);
}

// ─────────────────────────── renderLegend ───────────────────────────

/** Legenda codici → colore → label. */
export function renderLegend(): string {
  const items = ALL_CODES.map((code) => {
    const info = ACTIVITY_INFO[code];
    return `<div class="cal-legend-item">
      <div class="cal-legend-dot" style="background:${esc(info.cssColor)}">&nbsp;</div>
      <span>${esc(info.label)}</span>
    </div>`;
  }).join('');
  return `<div class="cal-legend">
    <span class="cal-legend-title">Legenda:</span>
    ${items}
    <span class="cal-legend-hint">Clicca un giorno per cambiare</span>
  </div>`;
}

// ─────────────────────────── renderMonth ───────────────────────────

/**
 * Card mese: header nome mese, riga giorni settimana L M M G V S D,
 * griglia giorni con celle act-{code} (+ today), summary conteggi.
 * Offset lunedì-based: (dow+6)%7 — port fedele CalcoliVari.
 * today: stringa YYYY-MM-DD per confronto.
 */
export function renderMonth(
  year: number,
  month: number,
  entriesMap: Map<string, string>,
  today: string,
): string {
  const dim = daysInMonth(year, month);
  // Offset: 1° giorno del mese, lunedì=0 (JS: domenica=0 → (dow+6)%7)
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  // Statistiche del mese
  const stats: Record<string, number> = {
    worked: 0, M: 0, F: 0, FS: 0, WE: 0, Malattia: 0, Donazione: 0,
  };

  // Celle giorno
  let dayCells = '';
  // Celle vuote di offset
  for (let i = 0; i < offset; i++) {
    dayCells += '<div class="cal-day empty"></div>';
  }
  for (let d = 1; d <= dim; d++) {
    const code = effectiveCode(entriesMap, year, month, d);
    // Confronto today: "YYYY-MM-DD" vs "YYYY-M-D" (not zero-padded)
    const dayIso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dayIso === today;
    const cls = `cal-day act-${esc(code)}${isToday ? ' today' : ''}`;

    // Accumula statistiche
    if (code === '8') stats['worked'] = (stats['worked'] ?? 0) + 1;
    else if (code in stats) stats[code] = (stats[code] ?? 0) + 1;

    dayCells += `<div class="${cls}" data-month="${esc(month)}" data-day="${esc(d)}"
      title="${esc(d)} ${esc(MONTHS[month - 1] ?? '')} - ${esc(ACTIVITY_INFO[code as ActivityCode]?.label ?? code)}">${esc(d)}</div>`;
  }

  // Summary — solo valori non-zero per F, FS, M, Malattia, Donazione; WE sempre
  const summary = [
    `<span><span class="badge badge-8">${esc(stats['worked'] ?? 0)}</span> lav</span>`,
    stats['M'] ? `<span><span class="badge badge-M">${esc(stats['M'])}</span> 1/2</span>` : '',
    `<span><span class="badge badge-WE">${esc(stats['WE'] ?? 0)}</span> WE</span>`,
    stats['F'] ? `<span><span class="badge badge-F">${esc(stats['F'])}</span> ferie</span>` : '',
    stats['FS'] ? `<span><span class="badge badge-FS">${esc(stats['FS'])}</span> fest</span>` : '',
    stats['Malattia'] ? `<span><span class="badge badge-Malattia">${esc(stats['Malattia'])}</span> mal</span>` : '',
    stats['Donazione'] ? `<span><span class="badge badge-Donazione">${esc(stats['Donazione'])}</span> don</span>` : '',
  ].join('');

  return `<div class="month-card">
    <div class="month-header">${esc(MONTHS[month - 1] ?? '')}</div>
    <div class="cal-weekdays">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((w) => `<span>${esc(w)}</span>`).join('')}</div>
    <div class="cal-days">${dayCells}</div>
    <div class="month-summary">${summary}</div>
  </div>`;
}

// ─────────────────────────── renderCalendario ───────────────────────────

/**
 * Calendario completo: legenda + 12 mesi.
 * entriesMap: Map<"month-day", activityCode> costruita dal fetch.
 * today: stringa YYYY-MM-DD.
 */
export function renderCalendario(
  year: number,
  entriesMap: Map<string, string>,
  today: string,
): string {
  const months = Array.from({ length: 12 }, (_, i) =>
    renderMonth(year, i + 1, entriesMap, today),
  ).join('');
  return `<div class="cal-page">
    <div class="cal-page-header"><h2>Calendario ${esc(year)}</h2></div>
    ${renderLegend()}
    <div class="calendar-grid">${months}</div>
  </div>`;
}

// ─────────────────────────── mount ───────────────────────────

/**
 * Costruisce entriesMap da array di entry.
 */
function buildEntriesMap(entries: CalendarEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) {
    m.set(mapKey(e.month, e.day), e.activityCode);
  }
  return m;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mount(container: HTMLElement): () => void {
  // Picker state
  let pickerEl: HTMLElement | null = null;
  let overlayEl: HTMLElement | null = null;

  function closePicker() {
    if (pickerEl) pickerEl.style.display = 'none';
    if (overlayEl) overlayEl.style.display = 'none';
  }

  return mountPage({
    container,
    route: '/calendario',
    render: async ({ main }) => {
      const year = getYear();
      main.innerHTML = `<div class="card"><p class="regime-note">Carico il calendario…</p></div>`;

      let entriesMap: Map<string, string>;
      try {
        const data = await api.get<CalendarioResponse>(`/api/calendario/${year}`);
        entriesMap = buildEntriesMap(data.entries);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Impossibile caricare il calendario. Riprova.';
        main.innerHTML = `<div class="card"><p class="regime-note regime-note-warn">${esc(msg)}</p></div>`;
        return;
      }

      const today = todayIso();

      function render() {
        main.innerHTML = renderCalendario(year, entriesMap, today);

        // Picker popup + overlay (creati dinamicamente, non nell'HTML statico)
        pickerEl = document.createElement('div');
        pickerEl.className = 'cal-picker-popup';
        pickerEl.style.display = 'none';
        overlayEl = document.createElement('div');
        overlayEl.className = 'cal-picker-overlay';
        overlayEl.style.display = 'none';
        main.appendChild(pickerEl);
        main.appendChild(overlayEl);

        overlayEl.addEventListener('click', closePicker);

        // Click su cella giorno
        main.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) => {
          cell.addEventListener('click', async (e) => {
            e.stopPropagation();
            const month = Number(cell.dataset['month']);
            const day = Number(cell.dataset['day']);
            const current = effectiveCode(entriesMap, year, month, day);

            // Costruisce popup picker
            const rect = cell.getBoundingClientRect();
            if (!pickerEl || !overlayEl) return;

            let html = `<div class="cal-picker-title">${esc(day)} ${esc(MONTHS[month - 1] ?? '')}</div>`;
            for (const code of ALL_CODES) {
              const info = ACTIVITY_INFO[code];
              const isSel = code === current;
              html += `<button class="cal-picker-btn${isSel ? ' is-current' : ''}" data-pick="${esc(code)}">
                <span class="pk-dot" style="background:${esc(info.cssColor)}"></span>
                ${esc(info.label)}
              </button>`;
            }
            pickerEl.innerHTML = html;

            // Posiziona popup
            const pw = 180;
            const ww = window.innerWidth;
            const wh = window.innerHeight;
            if (ww <= 768) {
              pickerEl.style.left = '50%';
              pickerEl.style.top = '50%';
              pickerEl.style.transform = 'translate(-50%, -50%)';
            } else {
              pickerEl.style.transform = '';
              let left = rect.right + 6;
              let top = rect.top;
              if (left + pw > ww) left = rect.left - pw;
              if (top + 300 > wh) top = wh - 310;
              pickerEl.style.left = `${left}px`;
              pickerEl.style.top = `${top}px`;
            }
            pickerEl.style.display = 'block';
            overlayEl.style.display = 'block';

            // Click su un pulsante del picker
            pickerEl.querySelectorAll<HTMLElement>('[data-pick]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const code = btn.dataset['pick'] as ActivityCode;
                closePicker();

                const defaultCode = getDefaultActivity(year, month, day);
                try {
                  if (code === defaultCode) {
                    // Torna al default → DELETE (rimuove l'override)
                    await api.del(`/api/calendario/${year}/${month}/${day}`);
                    entriesMap.delete(mapKey(month, day));
                  } else {
                    // PUT upsert
                    await api.put(`/api/calendario/${year}/${month}/${day}`, { activityCode: code });
                    entriesMap.set(mapKey(month, day), code);
                  }
                  render();
                } catch (err) {
                  const msg = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
                  // Mostra errore sobrio nella pagina senza distruggere il calendario
                  const errEl = document.createElement('div');
                  errEl.className = 'cal-error-toast';
                  errEl.textContent = msg;
                  main.insertBefore(errEl, main.firstChild);
                  setTimeout(() => errEl.remove(), 4000);
                }
              });
            });
          });
        });
      }

      render();
    },
  });
}
