// src/client/components/sidebar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSidebar } from './sidebar';
import type { MeResponse } from '@shared/types';

const me: MeResponse = {
  user: { id: 'u1', email: 'mattia@x.it', name: 'Mattia' },
  profiles: [
    { id: 'p1', slug: 'default', displayName: 'Mattia Rossi', giorniIncasso: 30 },
    { id: 'p2', slug: 'altro', displayName: 'Altro', giorniIncasso: 30 },
  ],
  activeProfile: { id: 'p1', slug: 'default', displayName: 'Mattia Rossi', giorniIncasso: 30 },
} as MeResponse;

test('renderSidebar: titoli sezioni e voce attiva', () => {
  const html = renderSidebar(me, '/scadenze', 2026);
  assert.match(html, /Principale/);
  assert.match(html, /Documenti/);
  assert.match(html, /Regime Forfettario/);
  assert.match(html, /class="sb-item active"[^>]*data-route="\/scadenze"/);
});

test('renderSidebar: selettore anno mostra l\'anno e ha le frecce', () => {
  const html = renderSidebar(me, '/', 2026);
  assert.match(html, /2026/);
  assert.match(html, /data-year-prev/);
  assert.match(html, /data-year-next/);
});

test('renderSidebar: footer con nome profilo, switch e logout', () => {
  const html = renderSidebar(me, '/', 2026);
  assert.match(html, /Mattia Rossi/);
  assert.match(html, /data-profile-switch/);
  assert.match(html, /data-logout/);
  assert.match(html, /<option value="altro"/);
});

test('renderSidebar: tutte le voci sono link (nessuna disabilitata)', () => {
  const html = renderSidebar(me, '/', 2026);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});
