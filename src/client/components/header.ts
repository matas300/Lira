// src/client/components/header.ts
import { logout, switchProfile } from '../lib/auth';
import type { MeResponse } from '@shared/types';

export function renderHeader(me: MeResponse, onUpdate: () => void): string {
  const optionsHtml = me.profiles
    .map((p) => `<option value="${p.slug}" ${p.slug === me.activeProfile.slug ? 'selected' : ''}>${p.displayName}</option>`)
    .join('');
  return `
    <header class="app-header">
      <a class="profile-pill" data-route="/profiles">
        <strong>${me.user.name}</strong>
        <span style="color:var(--text-muted);">·</span>
        <select data-profile-switch>${optionsHtml}</select>
      </a>
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
