// src/client/components/sidebar.ts
//
// Sidebar desktop (≥900px) portata da CalcoliVari (style.css:3184-3460):
// 240px collassabile a rail 60px, brand con logo, voci con icone SVG stroke,
// stato attivo mint. Su mobile resta la bottom-nav (vedi bottom-nav.ts).
// Lo stato collassato è UI state → localStorage (ammesso da CLAUDE.md) e
// vive come classe su <body> così sopravvive ai re-render della shell.

const COLLAPSED_KEY = 'lira_sidebar_collapsed';

export interface NavItem {
  route: string | null; // null = tab non ancora implementata (aria-disabled)
  label: string;
  icon: string; // SVG inline (stroke currentColor, port icone CalcoliVari)
}

// Icone SVG stroke 1.6 portate da CalcoliVari index.html (sb-ico).
const ICO_CLIENTI = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4" stroke-width="1.6"/><path d="M2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-4-5.7" stroke-width="1.6"/></svg>`;
const ICO_FATTURE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M14 3v5h5" stroke-width="1.6"/></svg>`;
const ICO_SCADENZE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.6"/><path d="M8 3v4M16 3v4M3 11h18M9 16l2 2 4-4" stroke-width="1.6"/></svg>`;
const ICO_DICHIARAZIONE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M9 12h7M9 16h7M9 8h3" stroke-width="1.6"/></svg>`;

// Stesse voci della bottom-nav (incluse le tab disabilitate).
export const NAV_ITEMS: NavItem[] = [
  { route: '/clienti', label: 'Clienti', icon: ICO_CLIENTI },
  { route: '/fatture', label: 'Fatture', icon: ICO_FATTURE },
  { route: null, label: 'Scadenze', icon: ICO_SCADENZE },
  { route: null, label: 'Dichiarazione', icon: ICO_DICHIARAZIONE },
];

function itemHtml(item: NavItem, activeRoute: string): string {
  const active = item.route !== null && item.route === activeRoute;
  if (item.route === null) {
    return `
      <a class="sb-item" aria-disabled="true" data-tab-label="${item.label}" title="${item.label} (in arrivo)">
        <span class="sb-ico">${item.icon}</span>
        <span class="sb-label">${item.label}</span>
      </a>`;
  }
  return `
    <a class="sb-item${active ? ' active' : ''}" data-route="${item.route}" href="${item.route}"
       data-tab-label="${item.label}" title="${item.label}"${active ? ' aria-current="page"' : ''}>
      <span class="sb-ico">${item.icon}</span>
      <span class="sb-label">${item.label}</span>
    </a>`;
}

export function renderSidebar(activeRoute: string): string {
  return `
    <aside class="sidebar" aria-label="Navigazione principale">
      <div class="sidebar-panel">
        <a class="sb-brand" data-route="/" href="/" title="Dashboard">
          <span class="sb-logo" aria-hidden="true">€</span>
          <span class="sb-brand-text">
            <span class="sb-brand-name">Lira</span>
            <span class="sb-brand-sub">Partita IVA</span>
          </span>
        </a>
        <nav class="sb-nav" role="navigation">
          <div class="sb-section-label">Principale</div>
          ${NAV_ITEMS.map((i) => itemHtml(i, activeRoute)).join('')}
        </nav>
        <div class="sb-spacer"></div>
        <div class="sb-footer">
          <button class="sb-collapse-btn" type="button" data-sb-collapse
                  aria-label="Comprimi/espandi barra laterale" title="Comprimi barra laterale">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </button>
        </div>
      </div>
    </aside>`;
}

/** Applica lo stato collassato persistito e cabla il toggle. Ritorna cleanup. */
export function wireSidebar(container: HTMLElement): () => void {
  document.body.classList.toggle('sidebar-collapsed', localStorage.getItem(COLLAPSED_KEY) === '1');

  const btn = container.querySelector<HTMLButtonElement>('[data-sb-collapse]');
  function onToggle(): void {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }
  btn?.addEventListener('click', onToggle);
  return () => btn?.removeEventListener('click', onToggle);
}
