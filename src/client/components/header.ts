// src/client/components/header.ts
import { logout, switchProfile } from '../lib/auth';
import { esc } from '../lib/dom';
import type { MeResponse } from '@shared/types';

export function renderHeader(me: MeResponse): string {
  const optionsHtml = me.profiles
    .map((p) => `<option value="${esc(p.slug)}" ${p.slug === me.activeProfile.slug ? 'selected' : ''}>${esc(p.displayName)}</option>`)
    .join('');
  // Il <select> sta FUORI dall'anchor: dentro, ogni click sul select
  // veniva intercettato dal router (closest('[data-route]')) e navigava via.
  return `
    <header class="app-header">
      <div class="profile-pill-group">
        <a class="profile-pill" data-route="/profiles" href="/profiles" title="Gestisci profili">
          <strong>${esc(me.user.name)}</strong>
        </a>
        <select class="input profile-select" data-profile-switch aria-label="Profilo attivo">${optionsHtml}</select>
      </div>
      <button class="btn btn-ghost" data-logout>Esci</button>
    </header>
  `;
}

export function wireHeader(container: HTMLElement, onChanged: () => void): () => void {
  const select = container.querySelector<HTMLSelectElement>('[data-profile-switch]');
  const btn = container.querySelector<HTMLButtonElement>('[data-logout]');

  async function onSwitch() {
    if (!select) return;
    try {
      await switchProfile(select.value);
      onChanged();
    } catch (err) {
      console.error('Switch profile failed', err);
    }
  }

  async function onLogout() {
    await logout();
    history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  select?.addEventListener('change', onSwitch);
  btn?.addEventListener('click', onLogout);

  return () => {
    select?.removeEventListener('change', onSwitch);
    btn?.removeEventListener('click', onLogout);
  };
}
