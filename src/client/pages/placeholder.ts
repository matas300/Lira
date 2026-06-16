// src/client/pages/placeholder.ts
// Pagina "in costruzione" condivisa: usata dalle voci sidebar non ancora
// implementate. Il titolo deriva dalla route corrente (labelForRoute).
import { esc, mountPage } from '../lib/dom';
import { labelForRoute } from '../lib/nav';

export function mount(container: HTMLElement): () => void {
  const route = location.pathname;
  const title = labelForRoute(route) || 'Pagina';
  return mountPage({
    container,
    route,
    render: ({ main }) => {
      main.innerHTML = `
        <div class="card">
          <h2 style="margin-bottom:var(--space-3);">${esc(title)}</h2>
          <p style="color:var(--color-text-muted);">Pagina in costruzione — arriverà in uno dei prossimi slice.</p>
        </div>`;
    },
  });
}
