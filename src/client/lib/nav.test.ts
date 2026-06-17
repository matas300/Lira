// src/client/lib/nav.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_SECTIONS, labelForRoute, ALL_ROUTES } from './nav';

test('nav: due sezioni Principale e Documenti', () => {
  assert.deepEqual(NAV_SECTIONS.map((s) => s.title), ['Principale', 'Documenti']);
});

test('nav: 8 voci con le route attese', () => {
  const routes = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.route));
  assert.deepEqual(routes, ['/', '/tasse', '/scadenze', '/calendario', '/fatture', '/budget', '/clienti', '/dichiarazione']);
});

test('nav: ogni voce ha label e icona svg', () => {
  for (const s of NAV_SECTIONS) for (const i of s.items) {
    assert.ok(i.label.length > 0);
    assert.match(i.icon, /^<svg/);
  }
});

test('labelForRoute: risolve la home e una route interna', () => {
  assert.equal(labelForRoute('/'), 'Regime Forfettario');
  assert.equal(labelForRoute('/scadenze'), 'Scadenze');
});

test('labelForRoute: route sconosciuta → stringa vuota', () => {
  assert.equal(labelForRoute('/ignota'), '');
});

test('ALL_ROUTES contiene tutte le 8 route', () => {
  assert.equal(ALL_ROUTES.length, 8);
});

test('labelForRoute: route fuori-nav del menu profilo hanno etichetta', () => {
  assert.equal(labelForRoute('/impostazioni'), 'Impostazioni');
  assert.equal(labelForRoute('/riepilogo'), 'Riepilogo');
  assert.equal(labelForRoute('/profilo-personale'), 'Profilo personale');
  assert.equal(labelForRoute('/profilo-piva'), 'Profilo P.IVA');
});
