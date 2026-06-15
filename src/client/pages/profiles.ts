// src/client/pages/profiles.ts
import { listProfiles, createProfile, switchProfile } from '../lib/auth';
import { ApiError } from '../lib/api';
import { esc, mountPage } from '../lib/dom';

export function mount(container: HTMLElement): () => void {
  return mountPage({
    container,
    route: '/profiles',
    render: async ({ me, main, rerender }) => {
      const { profiles } = await listProfiles();
      main.innerHTML = `
        <div class="card" style="margin-bottom:var(--space-6);">
          <h2 style="margin-bottom:var(--space-4);">Profili</h2>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-3);">
            ${profiles.map((p) => `
              <li style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-3);background:var(--bg);border-radius:var(--radius-md);">
                <span><strong>${esc(p.displayName)}</strong> <span style="color:var(--color-text-muted);">${esc(p.slug)}</span></span>
                ${p.slug === me.activeProfile.slug
                  ? `<span style="color:var(--color-primary);">attivo</span>`
                  : `<button class="btn btn-ghost" data-switch="${esc(p.slug)}">Attiva</button>`}
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
      `;

      // wire switch
      main.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await switchProfile(btn.dataset.switch!);
          await rerender();
        });
      });

      // wire create form
      const form = main.querySelector<HTMLFormElement>('[data-create]');
      const errorEl = main.querySelector<HTMLElement>('[data-error]');
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
          await rerender();
        } catch (err) {
          errorEl.textContent = err instanceof ApiError ? err.message : 'Errore';
          errorEl.hidden = false;
        }
      });
    },
  });
}
