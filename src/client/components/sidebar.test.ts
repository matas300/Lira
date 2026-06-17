// src/client/components/sidebar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSidebar } from './sidebar';
import type { MeResponse } from '@shared/types';

// Stub localStorage per Node (theme + collapsed key access in renderSidebar/wireSidebar)
{
  const _store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>)['localStorage'] = {
    getItem: (k: string) => _store.get(k) ?? null,
    setItem: (k: string, v: string) => void _store.set(k, v),
    removeItem: (k: string) => void _store.delete(k),
  };
}

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

test('renderSidebar: footer ha trigger menu profilo e le voci', () => {
  const html = renderSidebar(me, '/', 2026);
  assert.match(html, /data-profile-trigger/);
  assert.match(html, /data-profile-menu/);
  assert.match(html, /data-route="\/impostazioni"/);
  assert.match(html, /data-route="\/riepilogo"/);
  assert.match(html, /data-route="\/profilo-personale"/);
  assert.match(html, /data-route="\/profilo-piva"/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /data-logout/);
});

test('renderSidebar: le 3 voci future hanno il badge presto', () => {
  const html = renderSidebar(me, '/', 2026);
  const presto = (html.match(/sb-menu-tag/g) ?? []).length;
  assert.equal(presto, 3);
});
