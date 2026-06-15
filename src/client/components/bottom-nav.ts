// src/client/components/bottom-nav.ts
//
// Bottom-nav mobile (<900px) — evoluzione accettata rispetto a CalcoliVari.
// Icone SVG condivise con la sidebar; stato attivo mint sulla tab corrente.

import { NAV_ITEMS } from './sidebar';

export function renderBottomNav(activeRoute = ''): string {
  const tabs = NAV_ITEMS.map((item) => {
    if (item.route === null) {
      return `<a class="tab" aria-disabled="true">${item.icon}<span>${item.label}</span></a>`;
    }
    const active = item.route === activeRoute;
    return `<a class="tab${active ? ' active' : ''}" data-route="${item.route}" href="${item.route}"${active ? ' aria-current="page"' : ''}>${item.icon}<span>${item.label}</span></a>`;
  }).join('');
  return `<nav class="bottom-nav">${tabs}</nav>`;
}
