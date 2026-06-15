// src/client/components/modal.ts
//
// Modal vanilla riusabile (dark theme tokens, classi in components.css).
// openModal({title, bodyHtml, onMount}) → { close, root }.
// - ESC e click sul backdrop chiudono (solo il modal in cima allo stack:
//   i dialoghi di conferma possono aprirsi SOPRA un modal esistente).
// - Focus-trap basilare (Tab/Shift+Tab ciclano dentro al dialog).
// - onMount(root, close) per cablare il contenuto dopo l'inserimento nel DOM.
//
// In fondo: confirmModal/alertModal/promptDateModal, sostituti dei nativi
// confirm()/alert()/prompt() (audit fix #15).

import { esc } from '../lib/dom';

interface ModalOpts {
  title: string;
  bodyHtml: string;
  onMount?: (root: HTMLElement, close: () => void) => void;
  onClose?: () => void;
}

// Stack dei modal aperti: ESC/backdrop agiscono solo sul top.
const stack: HTMLElement[] = [];

export function openModal(opts: ModalOpts): { close: () => void; root: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  // Il title è testo semplice e va escapato (difesa-in-profondità: il
  // componente è riusabile e non deve mai diventare un vettore XSS).
  // bodyHtml resta raw: i chiamanti lo costruiscono già con esc().
  dialog.innerHTML = `
    <div class="modal-header">
      <h3>${esc(opts.title)}</h3>
      <button type="button" class="btn btn-ghost" data-modal-close aria-label="Chiudi">✕</button>
    </div>
    <div data-modal-body>${opts.bodyHtml}</div>
  `;
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  stack.push(backdrop);

  const prevActive = document.activeElement as HTMLElement | null;
  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    const i = stack.indexOf(backdrop);
    if (i !== -1) stack.splice(i, 1);
    backdrop.remove();
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
    opts.onClose?.();
  }

  function focusable(): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ));
  }

  function onKey(e: KeyboardEvent): void {
    if (stack[stack.length - 1] !== backdrop) return; // solo il modal in cima
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const els = focusable();
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  dialog.querySelector<HTMLElement>('[data-modal-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const body = dialog.querySelector<HTMLElement>('[data-modal-body]')!;
  opts.onMount?.(body, close);
  focusable()[0]?.focus();

  return { close, root: body };
}

// ─────────────── Dialoghi (sostituti di confirm/alert/prompt) ───────────────

export interface ConfirmOpts {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Sostituto di confirm(): Promise<boolean>. ESC/backdrop/Annulla → false. */
export function confirmModal(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title: opts.title ?? 'Conferma',
      bodyHtml: `
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(opts.cancelLabel ?? 'Annulla')}</button>
          <button type="button" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(opts.confirmLabel ?? 'Conferma')}</button>
        </div>`,
      onMount: (root, close) => {
        root.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', close);
        root.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click', () => {
          result = true;
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}

/** Sostituto di alert(). bodyHtml è HTML già escapato dal chiamante. */
export function alertModal(title: string, bodyHtml: string): Promise<void> {
  return new Promise((resolve) => {
    openModal({
      title,
      bodyHtml: `
        ${bodyHtml}
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" data-ok>OK</button>
        </div>`,
      onMount: (root, close) => {
        root.querySelector<HTMLButtonElement>('[data-ok]')?.addEventListener('click', close);
      },
      onClose: () => resolve(),
    });
  });
}

/** Sostituto di prompt() per una data: Promise<string|null> (null = annullato). */
export function promptDateModal(title: string, label: string, defaultValue: string): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    openModal({
      title,
      bodyHtml: `
        <form data-date-form>
          <div class="form-row">
            <label>${esc(label)}</label>
            <input class="input" type="date" data-date value="${esc(defaultValue)}" required />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-cancel>Annulla</button>
            <button type="submit" class="btn btn-primary" data-confirm>Conferma</button>
          </div>
        </form>`,
      onMount: (root, close) => {
        const form = root.querySelector<HTMLFormElement>('[data-date-form]')!;
        root.querySelector<HTMLButtonElement>('[data-cancel]')?.addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const v = root.querySelector<HTMLInputElement>('[data-date]')!.value;
          if (!v) return;
          result = v;
          close();
        });
      },
      onClose: () => resolve(result),
    });
  });
}
