// src/shared/schemas.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClienteCreateInput } from './schemas';

test('ClienteCreateInput — minimo valido PG con default', () => {
  const r = ClienteCreateInput.parse({ nome: 'ACME Srl', partitaIva: '00743110157' });
  assert.equal(r.tipoCliente, 'PG');
  assert.equal(r.codiceSdi, '0000000');
  assert.equal(r.nazione, 'IT');
});

test('ClienteCreateInput — normalizza uppercase nazione/provincia/SDI/CF', () => {
  const r = ClienteCreateInput.parse({
    nome: 'X', partitaIva: '00743110157',
    provincia: 'mi', nazione: 'it', codiceSdi: 'abc1234',
  });
  assert.equal(r.provincia, 'MI');
  assert.equal(r.nazione, 'IT');
  assert.equal(r.codiceSdi, 'ABC1234');
});

test('ClienteCreateInput — P.IVA con check-digit errato → throw', () => {
  assert.throws(() => ClienteCreateInput.parse({ nome: 'X', partitaIva: '00743110158' }));
});

test('ClienteCreateInput — cliente IT senza P.IVA né CF → throw (FatturaPA 1.4.1.2)', () => {
  assert.throws(() => ClienteCreateInput.parse({ nome: 'X', nazione: 'IT' }));
});

test('ClienteCreateInput — cliente Estero senza P.IVA/CF è ammesso', () => {
  const r = ClienteCreateInput.parse({ nome: 'Foreign Co', nazione: 'DE', tipoCliente: 'Estero' });
  assert.equal(r.nome, 'Foreign Co');
});

test('ClienteCreateInput — PA richiede SDI 6 char', () => {
  assert.throws(() => ClienteCreateInput.parse({
    nome: 'Comune', tipoCliente: 'PA', codiceFiscale: 'RSSMRA80A01H501U', codiceSdi: '0000000',
  }));
  const ok = ClienteCreateInput.parse({
    nome: 'Comune', tipoCliente: 'PA', codiceFiscale: 'RSSMRA80A01H501U', codiceSdi: 'ufxxxx',
  });
  assert.equal(ok.codiceSdi, 'UFXXXX');
});
