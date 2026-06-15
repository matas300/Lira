// src/client/pages/dashboard.ts
import { esc, mountPage } from '../lib/dom';

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/',
    render: ({ me, main }) => {
      main.innerHTML = `
        <div class="card">
          <h2 style="margin-bottom:var(--space-4);">Benvenuto, ${esc(me.user.name)}</h2>
          <p style="color:var(--color-text-muted);margin-bottom:var(--space-2);">Profilo attivo: <strong>${esc(me.activeProfile.displayName)}</strong></p>
          <p style="color:var(--color-text-muted);">Le funzioni fiscali arriveranno negli slice successivi.</p>
        </div>
      `;
    },
  });
}
