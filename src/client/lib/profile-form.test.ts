import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anagraficaDefaults, attivitaDefaults,
  anagraficaFromResponse, attivitaFromResponse,
  anagraficaToBody, attivitaToBody,
  copyResidenzaToDomicilio,
  fieldError,
} from './profile-form';

test('anagraficaDefaults: stringhe vuote, residenza/domicilio presenti', () => {
  const d = anagraficaDefaults();
  assert.equal(d.nome, '');
  assert.equal(d.residenza.citta, '');
  assert.equal(d.domicilio_fiscale.cap, '');
});

test('anagraficaFromResponse: legge i blob, default sui mancanti', () => {
  const s = anagraficaFromResponse({ nome: 'Mario', residenza: { citta: 'Roma' } });
  assert.equal(s.nome, 'Mario');
  assert.equal(s.cognome, '');
  assert.equal(s.residenza.citta, 'Roma');
  assert.equal(s.residenza.indirizzo, '');
  assert.equal(s.domicilio_fiscale.citta, '');
});

test('anagraficaToBody: produce oggetto con residenza/domicilio annidati', () => {
  const s = { ...anagraficaDefaults(), nome: 'Mario' };
  s.residenza.citta = 'Roma';
  const b = anagraficaToBody(s);
  assert.equal(b.nome, 'Mario');
  assert.equal((b.residenza as { citta: string }).citta, 'Roma');
});

test('attivitaFromResponse / attivitaToBody: round-trip campi attività', () => {
  const s = attivitaFromResponse({ partita_iva: '00743110157', codice_ateco: '62.01' });
  assert.equal(s.partita_iva, '00743110157');
  assert.equal(s.ateco_gruppo, '');
  const b = attivitaToBody(s);
  assert.equal(b.partita_iva, '00743110157');
  assert.equal('regime_default' in b, false); // non inviato (preservato lato server)
});

test('copyResidenzaToDomicilio: copia i 4 campi residenza in domicilio', () => {
  const s = anagraficaDefaults();
  s.residenza = { indirizzo: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'RM' };
  const out = copyResidenzaToDomicilio(s);
  assert.deepEqual(out.domicilio_fiscale, s.residenza);
});

test('fieldError: vuoto = nessun errore; formato sbagliato = messaggio', () => {
  assert.equal(fieldError('partita_iva', ''), null);
  assert.equal(fieldError('partita_iva', '123'), 'P.IVA non valida (11 cifre).');
  assert.equal(fieldError('partita_iva', '00743110157'), null);
  assert.equal(fieldError('cf', 'abc'), 'Codice fiscale non valido.');
  assert.equal(fieldError('cap', '123'), 'CAP non valido (5 cifre).');
  assert.equal(fieldError('cap', '00100'), null);
  assert.equal(fieldError('provincia', 'ROMA'), 'Provincia: 2 lettere.');
  assert.equal(fieldError('email', 'nope'), 'Email non valida.');
  assert.equal(fieldError('email', 'a@b.it'), null);
  assert.equal(fieldError('cf', 'rssmra80a01h501u'), null); // CF minuscolo valido accettato
});

test('anagraficaToBody / copyResidenzaToDomicilio: nessun aliasing dei sotto-oggetti', () => {
  const st = anagraficaDefaults();
  const b = anagraficaToBody(st) as { residenza: { citta: string } };
  b.residenza.citta = 'Mutato';
  assert.equal(st.residenza.citta, ''); // lo stato originale NON cambia

  const copied = copyResidenzaToDomicilio(st);
  copied.domicilio_fiscale.cap = '99999';
  assert.equal(st.residenza.cap, ''); // residenza originale NON tocca
});
