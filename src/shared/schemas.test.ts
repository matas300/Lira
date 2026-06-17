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

// ───── IsoDate (audit M17) ─────
import { IsoDate, PagamentoCreateInput } from './schemas';

test('IsoDate — accetta solo date reali del calendario', () => {
  assert.equal(IsoDate.parse('2026-03-01'), '2026-03-01');
  assert.equal(IsoDate.parse('2024-02-29'), '2024-02-29'); // bisestile
  assert.throws(() => IsoDate.parse('2026-99-99'));
  assert.throws(() => IsoDate.parse('2026-02-30'));
  assert.throws(() => IsoDate.parse('2026-13-01'));
  assert.throws(() => IsoDate.parse('2026-3-1'));
});

test('FatturaCreateInput — data inesistente (2026-99-99) → throw', () => {
  assert.throws(() => FatturaCreateInput.parse({
    clienteId: 'c1', data: '2026-99-99', righe: [{ descrizione: 'x', prezzoUnitario: 1 }],
  }));
});

test('PagamentoCreateInput — bound: importo > 0, year 2000-2100, data reale', () => {
  const ok = PagamentoCreateInput.parse({ year: 2026, data: '2026-06-30', tipo: 'tasse', importo: 1500 });
  assert.equal(ok.importo, 1500);
  assert.throws(() => PagamentoCreateInput.parse({ year: 2026, data: '2026-06-30', tipo: 'tasse', importo: 0 }));
  assert.throws(() => PagamentoCreateInput.parse({ year: 2026, data: '2026-06-30', tipo: 'tasse', importo: -5 }));
  assert.throws(() => PagamentoCreateInput.parse({ year: 1999, data: '2026-06-30', tipo: 'tasse', importo: 1 }));
  assert.throws(() => PagamentoCreateInput.parse({ year: 2101, data: '2026-06-30', tipo: 'tasse', importo: 1 }));
  assert.throws(() => PagamentoCreateInput.parse({ year: 2026, data: '2026-02-30', tipo: 'tasse', importo: 1 }));
});

// ───── Enum ripuliti (audit B22) ─────
import { StatoFatturaEnum, TipoDocumentoEnum } from './schemas';

test('enum — niente TD24 (non supportato) né stato annullata (irraggiungibile)', () => {
  assert.throws(() => TipoDocumentoEnum.parse('TD24'));
  assert.throws(() => StatoFatturaEnum.parse('annullata'));
  assert.equal(TipoDocumentoEnum.parse('TD04'), 'TD04');
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

// ───── Import XML (Slice 5E) ─────
import { ImportFatturaInput } from './schemas';

test('ImportFatturaInput — minimo valido', () => {
  const it = ImportFatturaInput.parse({
    tipoDocumento: 'TD01', numero: '2026/1', data: '2026-03-01',
    annoProgressivo: 2026, progressivo: 1, numeroDisplay: '2026/1',
    righe: [{ descrizione: 'Consulenza', prezzoUnitario: 1000 }],
    importo: 1000, marcaDaBollo: true,
    clienteSnapshot: { nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', nazione: 'IT' },
  });
  assert.equal(it.tipoDocumento, 'TD01');
  assert.equal(it.righe[0]!.quantita, 1);
  assert.equal(it.modalitaPagamento, null);
});

test('ImportFatturaInput — tipoDocumento invalido → throw', () => {
  assert.throws(() => ImportFatturaInput.parse({
    tipoDocumento: 'XX', numero: '1', data: '2026-03-01', annoProgressivo: 2026, progressivo: 1,
    numeroDisplay: '2026/1', righe: [{ descrizione: 'x', prezzoUnitario: 1 }], importo: 1,
    marcaDaBollo: false, clienteSnapshot: { nome: 'X', tipoCliente: 'PG', nazione: 'IT' },
  }));
});

// ───── Budget (Slice Budget) ─────
import { BudgetItemInput, BudgetPutInput } from './schemas';

test('BudgetPutInput accetta baseMonth null e items validi', () => {
  const r = BudgetPutInput.safeParse({
    baseMonth: null,
    items: [{ nome: 'Affitto', importo: 500, auto: false, ordine: 0 }],
  });
  assert.equal(r.success, true);
});

test('BudgetPutInput rifiuta baseMonth fuori range', () => {
  assert.equal(BudgetPutInput.safeParse({ baseMonth: 13, items: [] }).success, false);
  assert.equal(BudgetPutInput.safeParse({ baseMonth: 0, items: [] }).success, false);
});

test('BudgetItemInput rifiuta importo negativo', () => {
  assert.equal(
    BudgetItemInput.safeParse({ nome: 'X', importo: -1, auto: false, ordine: 0 }).success,
    false,
  );
});

// ───── Editor profilo (anagrafica/attività/patch) ─────
import { ProfileAnagrafica, ProfileAttivita, ProfilePatchInput } from './schemas';

test('ProfileAnagrafica — tutto opzionale, vuoto valido', () => {
  assert.deepEqual(ProfileAnagrafica.parse({}), {});
  const r = ProfileAnagrafica.parse({
    nome: 'Mario', cognome: 'Rossi', cf: 'rssmra80a01h501u',
    residenza: { indirizzo: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'rm' },
  });
  assert.equal(r.nome, 'Mario');
  assert.equal(r.cf, 'RSSMRA80A01H501U');      // CF normalizzato uppercase
  assert.equal(r.residenza?.provincia, 'RM');  // provincia uppercase
});

test('ProfileAttivita — partita_iva e ateco opzionali, regime_default NON nello schema', () => {
  const r = ProfileAttivita.parse({ partita_iva: '00743110157', codice_ateco: '62.01.00' });
  assert.equal(r.partita_iva, '00743110157');
  assert.equal('regime_default' in r, false);  // preservato lato server, non in input
});

test('ProfilePatchInput — campi tutti opzionali (patch parziale)', () => {
  assert.deepEqual(ProfilePatchInput.parse({}), {});
  const r = ProfilePatchInput.parse({ displayName: 'Mattia', giorniIncasso: 45 });
  assert.equal(r.displayName, 'Mattia');
  assert.equal(r.giorniIncasso, 45);
});

test('ProfilePatchInput — giorniIncasso negativo → errore', () => {
  assert.throws(() => ProfilePatchInput.parse({ giorniIncasso: -1 }));
});
