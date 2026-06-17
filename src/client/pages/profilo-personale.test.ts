import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderForm } from './profilo-personale';
import { anagraficaDefaults } from '../lib/profile-form';

test('renderForm: campi identificativi e displayName presenti', () => {
  const html = renderForm('Mattia', anagraficaDefaults());
  assert.match(html, /data-field="displayName"/);
  assert.match(html, /value="Mattia"/);
  assert.match(html, /data-field="nome"/);
  assert.match(html, /data-field="cognome"/);
  assert.match(html, /data-field="cf"/);
  assert.match(html, /Salva/);
});

test('renderForm: sezioni residenza e domicilio fiscale con campi annidati', () => {
  const html = renderForm('X', anagraficaDefaults());
  assert.match(html, /data-field="residenza.indirizzo"/);
  assert.match(html, /data-field="residenza.cap"/);
  assert.match(html, /data-field="domicilio_fiscale.citta"/);
  assert.match(html, /data-same-domicilio/); // checkbox "uguale a residenza"
});

test('renderForm: recapiti (telefono/email/iban/modalita)', () => {
  const html = renderForm('X', anagraficaDefaults());
  assert.match(html, /data-field="telefono"/);
  assert.match(html, /data-field="email"/);
  assert.match(html, /data-field="iban"/);
  assert.match(html, /data-field="modalita_pagamento"/);
});

test('renderForm: pre-popola i valori esistenti', () => {
  const st = anagraficaDefaults();
  st.nome = 'Mario';
  st.residenza.citta = 'Roma';
  const html = renderForm('X', st);
  assert.match(html, /value="Mario"/);
  assert.match(html, /value="Roma"/);
});
