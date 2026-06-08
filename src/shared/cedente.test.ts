// src/shared/cedente.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCedenteFromProfile, type Cedente } from './cedente';

const anagraficaOk = {
  cf: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
  residenza: { indirizzo: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI' },
};
const attivitaOk = { partita_iva: '00743110157' };

test('readCedenteFromProfile — profilo completo -> cedente', () => {
  const r = readCedenteFromProfile({ anagrafica: anagraficaOk, attivita: attivitaOk, regime: 'forfettario' });
  assert.ok('cedente' in r);
  const c = (r as { cedente: Cedente }).cedente;
  assert.equal(c.partitaIva, '00743110157');
  assert.equal(c.nome, 'Mario');
  assert.equal(c.cognome, 'Rossi');
  assert.equal(c.cap, '20100');
  assert.equal(c.provincia, 'MI');
  assert.equal(c.regime, 'forfettario');
});

test('readCedenteFromProfile — P.IVA mancante -> errori (audit A2)', () => {
  const r = readCedenteFromProfile({ anagrafica: anagraficaOk, attivita: {}, regime: 'forfettario' });
  assert.ok('errors' in r);
  assert.ok((r as { errors: string[] }).errors.some((e) => /P\.IVA/i.test(e)));
});

test('readCedenteFromProfile — sede incompleta -> errori elencati', () => {
  const r = readCedenteFromProfile({
    anagrafica: { ...anagraficaOk, residenza: { indirizzo: '', cap: '', citta: '', provincia: '' } },
    attivita: attivitaOk, regime: 'forfettario',
  });
  assert.ok('errors' in r);
  const errs = (r as { errors: string[] }).errors;
  assert.ok(errs.some((e) => /indirizzo/i.test(e)));
  assert.ok(errs.some((e) => /CAP/i.test(e)));
});

test('readCedenteFromProfile — ne denominazione ne nome+cognome -> errore', () => {
  const r = readCedenteFromProfile({
    anagrafica: { ...anagraficaOk, nome: '', cognome: '' },
    attivita: attivitaOk, regime: 'forfettario',
  });
  assert.ok('errors' in r);
});
