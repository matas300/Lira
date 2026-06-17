import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderForm, renderConfigBanner } from './impostazioni';
import { defaults } from '../lib/year-settings-form';

test('renderForm: campi core presenti, ordinario disabilitato', () => {
  const html = renderForm(defaults());
  assert.match(html, /Forfettario/);
  assert.match(html, /Ordinario/);
  assert.match(html, /disabled/);
  assert.match(html, /data-field="coefficiente"/);
  assert.match(html, /data-field="impostaSostitutiva"/);
  assert.match(html, /data-field="inpsMode"/);
  assert.match(html, /data-field="limiteForfettario"/);
  assert.match(html, /Salva parametri/);
});

test('renderForm: sezione avanzate collassata (details senza open)', () => {
  const html = renderForm(defaults());
  assert.match(html, /<details class="ys-advanced">/);
  assert.doesNotMatch(html, /<details class="ys-advanced" open>/);
});

test('renderForm: pre-seleziona il coefficiente salvato (78%)', () => {
  const html = renderForm({ ...defaults(), coefficiente: 0.78 });
  assert.match(html, /value="0.78"[^>]*selected/);
});

test('renderForm: categoria INPS mostrata solo con artigiani_commercianti', () => {
  const sep = renderForm({ ...defaults(), inpsMode: 'gestione_separata' });
  assert.doesNotMatch(sep, /data-field="inpsCategoria"/);
  const ac = renderForm({ ...defaults(), inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano' });
  assert.match(ac, /data-field="inpsCategoria"/);
});

test('renderConfigBanner: appare solo per anno nuovo', () => {
  assert.match(renderConfigBanner(true, 2026), /non ancora configurato/i);
  assert.equal(renderConfigBanner(false, 2026), '');
});
