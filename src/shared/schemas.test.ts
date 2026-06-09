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

// ───── Fatture (Slice 5A) ─────
import { FatturaCreateInput, RigaSchema } from './schemas';

test('RigaSchema — quantità default 1, prezzo richiesto', () => {
  const r = RigaSchema.parse({ descrizione: 'Consulenza', prezzoUnitario: 100 });
  assert.equal(r.quantita, 1);
  assert.equal(r.prezzoUnitario, 100);
});

test('FatturaCreateInput — minimo valido (default TD01, ritenuta 0)', () => {
  const f = FatturaCreateInput.parse({
    clienteId: 'c1', data: '2026-03-01',
    righe: [{ descrizione: 'x', prezzoUnitario: 500 }],
  });
  assert.equal(f.tipoDocumento, 'TD01');
  assert.equal(f.ritenuta, 0);
  assert.equal(f.marcaDaBollo, false);
  assert.equal(f.righe[0]!.quantita, 1);
});

test('FatturaCreateInput — righe vuote → throw', () => {
  assert.throws(() => FatturaCreateInput.parse({ clienteId: 'c1', data: '2026-03-01', righe: [] }));
});

test('FatturaCreateInput — data non ISO → throw', () => {
  assert.throws(() => FatturaCreateInput.parse({
    clienteId: 'c1', data: '01/03/2026', righe: [{ descrizione: 'x', prezzoUnitario: 1 }],
  }));
});

// ───── Note di Credito (Slice 5C) ─────
import { NotaCreditoCreateInput } from './schemas';

test('NotaCreditoCreateInput — minimo valido', () => {
  const nc = NotaCreditoCreateInput.parse({
    data: '2026-04-01', righe: [{ descrizione: 'Storno', prezzoUnitario: 100 }],
  });
  assert.equal(nc.righe[0]!.quantita, 1);
  assert.equal(nc.righe[0]!.prezzoUnitario, 100);
});

test('NotaCreditoCreateInput — righe vuote → throw', () => {
  assert.throws(() => NotaCreditoCreateInput.parse({ data: '2026-04-01', righe: [] }));
});

test('NotaCreditoCreateInput — data non ISO → throw', () => {
  assert.throws(() => NotaCreditoCreateInput.parse({ data: '01/04/2026', righe: [{ descrizione: 'x', prezzoUnitario: 1 }] }));
});
