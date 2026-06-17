import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderForm } from './profilo-piva';
import { attivitaDefaults } from '../lib/profile-form';

test('renderForm: campi attività e giorniIncasso presenti', () => {
  const html = renderForm(attivitaDefaults(), 30);
  assert.match(html, /data-field="partita_iva"/);
  assert.match(html, /data-field="codice_ateco"/);
  assert.match(html, /data-field="descrizione_attivita"/);
  assert.match(html, /data-field="comune_domicilio"/);
  assert.match(html, /data-field="data_inizio_attivita"/);
  assert.match(html, /data-field="giorniIncasso"/);
  assert.match(html, /value="30"/);
});

test('renderForm: select gruppo ATECO popolata (9 gruppi) e pre-selezione', () => {
  const st = attivitaDefaults();
  st.ateco_gruppo = '0.78';
  const html = renderForm(st, 30);
  assert.match(html, /data-field="ateco_gruppo"/);
  const opts = (html.match(/<option /g) ?? []).length;
  assert.ok(opts >= 9, `attesi >=9 option, trovati ${opts}`);
});

test('renderForm: nota startup 5% con link a /impostazioni sulla data inizio', () => {
  const html = renderForm(attivitaDefaults(), 30);
  assert.match(html, /startup 5%/i);
  assert.match(html, /data-route="\/impostazioni"/);
});

test('renderForm: pre-popola i valori esistenti', () => {
  const st = attivitaDefaults();
  st.partita_iva = '00743110157';
  const html = renderForm(st, 45);
  assert.match(html, /value="00743110157"/);
  assert.match(html, /value="45"/);
});
