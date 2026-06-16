// src/client/lib/scadenza-timing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scadenzaTiming } from './scadenza-timing';

const TODAY = '2026-06-16';

test('scadenzaTiming: dueDate ieri → scaduta, tone danger', () => {
  const r = scadenzaTiming('2026-06-15', TODAY);
  assert.equal(r.state, 'scaduta');
  assert.equal(r.tone, 'danger');
  assert.match(r.label, /Scaduta/i);
});

test('scadenzaTiming: dueDate oggi → imminente "Oggi", tone warn', () => {
  const r = scadenzaTiming('2026-06-16', TODAY);
  assert.equal(r.state, 'imminente');
  assert.equal(r.tone, 'warn');
  assert.match(r.label, /Oggi/i);
});

test('scadenzaTiming: dueDate +10 giorni → imminente con Ng, tone warn', () => {
  const r = scadenzaTiming('2026-06-26', TODAY);
  assert.equal(r.state, 'imminente');
  assert.equal(r.tone, 'warn');
  assert.match(r.label, /10/);
});

test('scadenzaTiming: dueDate +30 giorni → imminente (boundary incluso), tone warn', () => {
  const r = scadenzaTiming('2026-07-16', TODAY);
  assert.equal(r.state, 'imminente');
  assert.equal(r.tone, 'warn');
});

test('scadenzaTiming: dueDate +60 giorni → futura, tone ok', () => {
  const r = scadenzaTiming('2026-08-15', TODAY);
  assert.equal(r.state, 'futura');
  assert.equal(r.tone, 'ok');
  // label contiene la data formattata
  assert.match(r.label, /2026/);
});

test('scadenzaTiming: dueDate +31 giorni → futura, tone ok', () => {
  const r = scadenzaTiming('2026-07-17', TODAY);
  assert.equal(r.state, 'futura');
  assert.equal(r.tone, 'ok');
});
