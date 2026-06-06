import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from './detect';

test('detect: export ufficiale flat → profileName da prefisso', () => {
  const r = detect({
    'calcoliPIVA_Mattia_2025': { settings: {} },
    'calcoliPIVA_Mattia_clienti': [],
    'calcoliPIVA_profile_Mattia': { nome: 'M' },
  });
  assert.equal(r.profileName, 'Mattia');
  assert.deepEqual(r.keys['calcoliPIVA_Mattia_2025'], { settings: {} });
});

test('detect: profileName anche se ci sono solo year-data', () => {
  const r = detect({ 'calcoliPIVA_Peru_2024': { settings: {} } });
  assert.equal(r.profileName, 'Peru');
});

test('detect: backup-wrapper → unwrap + ri-parse stringhe', () => {
  const r = detect({
    profile: 'Mattia',
    timestamp: '2026-05-25T00:00:00Z',
    keys: { 'calcoliPIVA_Mattia_2025': '{"settings":{"regime":"forfettario"}}' },
  });
  assert.equal(r.profileName, 'Mattia');
  assert.deepEqual(r.keys['calcoliPIVA_Mattia_2025'], { settings: { regime: 'forfettario' } });
});

test('detect: keys globali non confondono il profileName', () => {
  const r = detect({
    'calcoliPIVA_activeTab': 'home',
    'calcoliPIVA_Mattia_2025': { settings: {} },
  });
  assert.equal(r.profileName, 'Mattia');
});
