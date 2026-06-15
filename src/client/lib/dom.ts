// src/client/lib/dom.ts
//
// Helper DOM condivisi del client.
// - esc(): escape HTML per OGNI dato dinamico interpolato in innerHTML
//   (unica copia: prima era triplicata in modal/clienti/fatture).
// - mountPage(): fattorizza il boilerplate di pagina autenticata
//   (getMe → redirect login → shell sidebar+header+main+bottom-nav → wiring),
//   prima quadruplicato in dashboard/profiles/clienti/fatture.

import { getMe } from './auth';
import { renderHeader, wireHeader } from '../components/header';
import { renderSidebar, wireSidebar } from '../components/sidebar';
import { renderBottomNav } from '../components/bottom-nav';
import type { MeResponse } from '@shared/types';

/** Escape HTML — usare per ogni valore dinamico dentro template innerHTML. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
}

export function redirectToLogin(): void {
  history.pushState({}, '', '/login');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export interface PageCtx {
  me: MeResponse;
  /** Il <main class="app-main"> dove la pagina renderizza il proprio contenuto. */
  main: HTMLElement;
  /** Re-render completo della pagina (shell inclusa), es. dopo switch profilo. */
  rerender: () => Promise<void>;
}

export interface MountPageOpts {
  container: HTMLElement;
  /** Route attiva, usata per lo stato attivo di sidebar/bottom-nav. */
  route: string;
  /** Render del contenuto pagina dentro ctx.main. */
  render: (ctx: PageCtx) => void | Promise<void>;
  /** Cleanup specifico della pagina (es. chiusura modal aperti). */
  onUnmount?: () => void;
}

/** Monta una pagina autenticata con shell standard. Ritorna l'unmount. */
export function mountPage(opts: MountPageOpts): () => void {
  let cleanups: Array<() => void> = [];
  let disposed = false;

  async function render(): Promise<void> {
    const me = await getMe();
    if (disposed) return;
    if (!me) { redirectToLogin(); return; }

    opts.container.innerHTML = `
      <div class="app-shell">
        ${renderSidebar(opts.route)}
        ${renderHeader(me)}
        <main class="app-main"></main>
        ${renderBottomNav(opts.route)}
      </div>`;

    for (const fn of cleanups) fn();
    cleanups = [
      wireHeader(opts.container, render),
      wireSidebar(opts.container),
    ];

    const main = opts.container.querySelector<HTMLElement>('.app-main')!;
    await opts.render({ me, main, rerender: render });
  }

  void render();

  return () => {
    disposed = true;
    for (const fn of cleanups) fn();
    cleanups = [];
    opts.onUnmount?.();
  };
}
