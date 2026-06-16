// src/client/lib/nav.ts
// Unica sorgente dei metadati di navigazione: usata da sidebar, routing e
// pagina placeholder. Icone SVG stroke (port/estensione da CalcoliVari).

export interface NavItem {
  route: string;
  label: string;
  icon: string; // SVG inline, stroke currentColor
}
export interface NavSection {
  title: string;
  items: NavItem[];
}

const ICO_REGIME = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l5-5 3 3 7-7M14 9h5v5" stroke-width="1.6"/></svg>`;
const ICO_TASSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.6"/><path d="M8 3v4M16 3v4M3 11h18M12 14v4M10 16h4" stroke-width="1.6"/></svg>`;
const ICO_SCADENZE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.6"/><path d="M8 3v4M16 3v4M3 11h18M9 16l2 2 4-4" stroke-width="1.6"/></svg>`;
const ICO_CALENDARIO = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.6"/><path d="M8 3v4M16 3v4M3 11h18" stroke-width="1.6"/></svg>`;
const ICO_FATTURE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M14 3v5h5" stroke-width="1.6"/></svg>`;
const ICO_BUDGET = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M8 7h6a2.5 2.5 0 010 5H9a2.5 2.5 0 000 5h7" stroke-width="1.6"/></svg>`;
const ICO_CLIENTI = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4" stroke-width="1.6"/><path d="M2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-4-5.7" stroke-width="1.6"/></svg>`;
const ICO_DICHIARAZIONE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M9 12h7M9 16h7M9 8h3" stroke-width="1.6"/></svg>`;

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Principale',
    items: [
      { route: '/', label: 'Regime Forfettario', icon: ICO_REGIME },
      { route: '/tasse', label: 'Tasse Accantonate', icon: ICO_TASSE },
      { route: '/scadenze', label: 'Scadenze', icon: ICO_SCADENZE },
      { route: '/calendario', label: 'Calendario', icon: ICO_CALENDARIO },
    ],
  },
  {
    title: 'Documenti',
    items: [
      { route: '/fatture', label: 'Fatture', icon: ICO_FATTURE },
      { route: '/budget', label: 'Budget', icon: ICO_BUDGET },
      { route: '/clienti', label: 'Clienti', icon: ICO_CLIENTI },
      { route: '/dichiarazione', label: 'Dichiarazione', icon: ICO_DICHIARAZIONE },
    ],
  },
];

export const ALL_ROUTES: string[] = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.route));

export function labelForRoute(route: string): string {
  for (const s of NAV_SECTIONS) for (const i of s.items) if (i.route === route) return i.label;
  return '';
}
