// src/client/pages/profiles.ts
import { getMe, listProfiles, createProfile, switchProfile } from '../lib/auth';
import { ApiError } from '../lib/api';
import { renderHeader, wireHeader } from '../components/header';
import { renderBottomNav } from '../components/bottom-nav';
import type { ProfilePublic } from '@shared/types';

export function mount(container: HTMLElement): () => void {
  let cleanupHeader: (() => void) | null = null;

  async function render() {
    const me = await getMe();
    if (!me) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const { profiles } = await listProfiles();
    container.innerHTML = `
      <div class="app-shell">
        ${renderHeader(me, render)}
        <main class="app-main">
          <div class="card" style="margin-bottom:var(--space-6);">
            <h2 style="margin-bottom:var(--space-4);">Profili</h2>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-3);">
              ${profiles.map((p) => `
                <li style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3);background:var(--bg);border-radius:var(--radius-md);">
                  <span><strong>${p.displayName}</strong> <span style="color:var(--text-muted);">${p.slug}</span></span>
                  ${p.slug === me.activeProfile.slug
                    ? `<span style="color:var(--mint);">attivo</span>`
                    : `<button class="btn btn-ghost" data-switch="${p.slug}">Attiva</button>`}
                </li>
              `).join('')}
            </ul>
          </div>

          <form class="card" data-create>
            <h3 style="margin-bottom:var(--space-4);">Nuovo profilo</h3>
            <div class="form-row">
              <label>Slug (es. peru)</label>
              <input class="input" name="slug" required pattern="[a-z0-9-]+" maxlength="40" />
            </div>
            <div class="form-row">
              <label>Display name</label>
              <input class="input" name="displayName" required maxlength="100" />
            </div>
            <button type="submit" class="btn btn-primary">Crea</button>
            <p class="form-error" data-error hidden></p>
          </form>
        </main>
        ${renderBottomNav()}
      </div>
    `;
    if (cleanupHeader) cleanupHeader();
    cleanupHeader = wireHeader(container, render);

    // wire switch
    container.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await switchProfile(btn.dataset.switch!);
        await render();
      });
    });

    // wire create form
    const form = container.querySelector<HTMLFormElement>('[data-create]');
    const errorEl = container.querySelector<HTMLElement>('[data-error]');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!errorEl) return;
      errorEl.hidden = true;
      const fd = new FormData(form);
      try {
        await createProfile({
          slug: String(fd.get('slug')),
          displayName: String(fd.get('displayName')),
        });
        await render();
      } catch (err) {
        errorEl.textContent = err instanceof ApiError ? err.message : 'Errore';
        errorEl.hidden = false;
      }
    });
  }

  render();

  return () => { if (cleanupHeader) cleanupHeader(); };
}
