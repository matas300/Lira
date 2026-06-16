// src/client/components/sidebar.ts
// Sidebar unica (desktop + mobile), porta la struttura CalcoliVari: 2 sezioni,
// selettore anno in alto, profilo+Esci nel footer. Stato collassato in
// localStorage (UI-state). Default collassata su viewport stretti al primo uso.
import { esc } from '../lib/dom';
import { NAV_SECTIONS } from '../lib/nav';
import { getYear, setYear } from '../lib/year';
import { logout, switchProfile } from '../lib/auth';
import type { MeResponse } from '@shared/types';

const COLLAPSED_KEY = 'lira_sidebar_collapsed';

function itemHtml(route: string, label: string, icon: string, activeRoute: string): string {
  const active = route === activeRoute;
  return `
    <a class="sb-item${active ? ' active' : ''}" data-route="${route}" href="${route}"
       data-tab-label="${esc(label)}" title="${esc(label)}"${active ? ' aria-current="page"' : ''}>
      <span class="sb-ico">${icon}</span>
      <span class="sb-label">${esc(label)}</span>
    </a>`;
}

export function renderSidebar(me: MeResponse, activeRoute: string, year: number): string {
  const sections = NAV_SECTIONS.map((s) => `
    <div class="sb-section-label">${esc(s.title)}</div>
    ${s.items.map((i) => itemHtml(i.route, i.label, i.icon, activeRoute)).join('')}`).join('');

  const options = me.profiles
    .map((p) => `<option value="${esc(p.slug)}" ${p.slug === me.activeProfile.slug ? 'selected' : ''}>${esc(p.displayName)}</option>`)
    .join('');
  const initial = esc((me.activeProfile.displayName || me.user.name).charAt(0).toUpperCase());

  return `
    <aside class="sidebar" aria-label="Navigazione principale">
      <div class="sidebar-panel">
        <div class="sb-top">
          <a class="sb-brand" data-route="/" href="/" title="Regime Forfettario">
            <span class="sb-logo" aria-hidden="true">€</span>
            <span class="sb-brand-text">
              <span class="sb-brand-name">Lira</span>
              <span class="sb-brand-sub">Partita IVA</span>
            </span>
          </a>
          <div class="sb-year" role="group" aria-label="Anno">
            <button type="button" class="sb-year-btn" data-year-prev aria-label="Anno precedente">‹</button>
            <span class="sb-year-val" data-year-val>${year}</span>
            <button type="button" class="sb-year-btn" data-year-next aria-label="Anno successivo">›</button>
          </div>
        </div>
        <nav class="sb-nav" role="navigation">${sections}</nav>
        <div class="sb-spacer"></div>
        <div class="sb-footer">
          <a class="sb-profile" data-route="/profiles" href="/profiles" title="Gestisci profili">
            <span class="sb-avatar" aria-hidden="true">${initial}</span>
            <span class="sb-profile-name">${esc(me.activeProfile.displayName)}</span>
          </a>
          <select class="input sb-profile-select" data-profile-switch aria-label="Profilo attivo">${options}</select>
          <div class="sb-footer-actions">
            <button class="btn btn-ghost sb-logout" type="button" data-logout>Esci</button>
            <button class="sb-collapse-btn" type="button" data-sb-collapse aria-label="Comprimi/espandi barra laterale" title="Comprimi barra laterale">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
            </button>
          </div>
        </div>
      </div>
    </aside>`;
}

/** Applica stato collassato, cabla collapse / switch profilo / logout / anno. */
export function wireSidebar(container: HTMLElement, opts: { onChanged: () => void }): () => void {
  // Default collassata su viewport stretti se nessuna preferenza salvata.
  if (localStorage.getItem(COLLAPSED_KEY) === null && window.matchMedia('(max-width: 700px)').matches) {
    localStorage.setItem(COLLAPSED_KEY, '1');
  }
  document.body.classList.toggle('sidebar-collapsed', localStorage.getItem(COLLAPSED_KEY) === '1');

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel);
  const collapseBtn = q<HTMLButtonElement>('[data-sb-collapse]');
  const select = q<HTMLSelectElement>('[data-profile-switch]');
  const logoutBtn = q<HTMLButtonElement>('[data-logout]');
  const prev = q<HTMLButtonElement>('[data-year-prev]');
  const next = q<HTMLButtonElement>('[data-year-next]');

  function onCollapse(): void {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }
  async function onSwitch(): Promise<void> {
    if (!select) return;
    try { await switchProfile(select.value); opts.onChanged(); }
    catch (err) { console.error('Switch profile failed', err); }
  }
  async function onLogout(): Promise<void> {
    await logout();
    history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  function onPrev(): void { setYear(getYear() - 1); opts.onChanged(); }
  function onNext(): void { setYear(getYear() + 1); opts.onChanged(); }

  collapseBtn?.addEventListener('click', onCollapse);
  select?.addEventListener('change', onSwitch);
  logoutBtn?.addEventListener('click', onLogout);
  prev?.addEventListener('click', onPrev);
  next?.addEventListener('click', onNext);

  return () => {
    collapseBtn?.removeEventListener('click', onCollapse);
    select?.removeEventListener('change', onSwitch);
    logoutBtn?.removeEventListener('click', onLogout);
    prev?.removeEventListener('click', onPrev);
    next?.removeEventListener('click', onNext);
  };
}
