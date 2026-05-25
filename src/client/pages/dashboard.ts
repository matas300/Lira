// src/client/pages/dashboard.ts
import { getMe } from '../lib/auth';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;

  async function render() {
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
            <h2 style="margin-bottom:var(--space-4);">Benvenuto, ${me.user.name}</h2>
            <p style="color:var(--text-muted);margin-bottom:var(--space-2);">Profilo attivo: <strong>${me.activeProfile.displayName}</strong></p>
            <p style="color:var(--text-muted);">Le funzioni fiscali arriveranno negli slice successivi.</p>
          </div>
        </main>
        ${renderBottomNav()}
      </div>
    `;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);
  }

  render();

  return () => { if (cleanupHeader) cleanupHeader(); };
}
