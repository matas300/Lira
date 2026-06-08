// src/client/components/modal.ts
//
// Modal vanilla riusabile (dark theme tokens). Nessun framework.
// openModal({title, bodyHtml, onMount}) → { close, root }.
// - ESC e click sul backdrop chiudono.
// - Focus-trap basilare (Tab/Shift+Tab ciclano dentro al dialog).
// - onMount(root, close) per cablare il contenuto dopo l'inserimento nel DOM.

interface ModalOpts {
  title: string;
  bodyHtml: string;
  onMount?: (root: HTMLElement, close: () => void) => void;
}

// Il title è testo semplice e va escapato prima di finire in innerHTML
// (difesa-in-profondità: oggi i title sono statici o numeri fattura, ma il
// componente è riusabile e non deve mai diventare un vettore XSS).
// bodyHtml resta raw: i chiamanti lo costruiscono già con il proprio esc().
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
}

export function openModal(opts: ModalOpts): { close: () => void; root: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;'
    + 'justify-content:center;z-index:1000;padding:var(--space-4);';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog card';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.style.cssText =
    'background:var(--surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);'
    + 'box-shadow:var(--shadow-modal);max-width:560px;width:100%;max-height:90vh;overflow:auto;padding:var(--space-5);';
  dialog.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">
      <h3 style="margin:0;">${esc(opts.title)}</h3>
      <button type="button" class="btn btn-ghost" data-modal-close aria-label="Chiudi">✕</button>
    </div>
    <div data-modal-body>${opts.bodyHtml}</div>
  `;
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const prevActive = document.activeElement as HTMLElement | null;

  function close(): void {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
  }

  function focusable(): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ));
  }

  function onKey(e: KeyboardEvent): void {
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
