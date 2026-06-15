// src/shared/import-fattura.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumero, matchCliente, dedupKey, buildImportItem, type RawFattura } from './import-fattura';

test('parseNumero — formati 3/2026, 2026/3, 42 puro, non parsabile', () => {
  assert.deepEqual(parseNumero('3/2026'), { progressivo: 3, anno: 2026 });
  assert.deepEqual(parseNumero('2026/3'), { anno: 2026, progressivo: 3 });
  assert.deepEqual(parseNumero('42'), { progressivo: 42, anno: 0 });
  assert.deepEqual(parseNumero('FT-001'), { progressivo: 0, anno: 0 });
});

test('matchCliente — P.IVA poi CF, miss → null', () => {
  const clienti = [
    { id: 'c1', partitaIva: '00743110157', codiceFiscale: null },
    { id: 'c2', partitaIva: null, codiceFiscale: 'RSSMRA80A01H501U' },
  ];
  assert.equal(matchCliente({ partitaIva: '00743110157' }, clienti), 'c1');
  assert.equal(matchCliente({ partitaIva: null, codiceFiscale: 'rssmra80a01h501u' }, clienti), 'c2');
  assert.equal(matchCliente({ partitaIva: '99999999999' }, clienti), null);
});

test('dedupKey — distingue TD01 e TD04', () => {
  const base = { tipoDocumento: 'TD01', annoProgressivo: 2026, progressivo: 1, numero: '2026/1' };
  assert.equal(dedupKey(base), 'TD01|2026|1|2026/1');
  assert.equal(dedupKey({ ...base, tipoDocumento: 'TD04' }), 'TD04|2026|1|2026/1');
});

function rawBase(over: Partial<RawFattura> = {}): RawFattura {
  return {
    tipoDocumento: 'TD01', data: '2026-03-01', numero: '2026/5', importoTotale: 1000, bolloImporto: 0,
    modalitaPagamento: 'MP05',
    cliente: {
      denominazione: 'ACME Srl', nome: '', cognome: '', partitaIva: '00743110157', idPaese: '', idCodice: '00743110157',
      codiceFiscale: '', indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO', nazione: 'IT',
    },
    righe: [{ descrizione: 'Consulenza', quantita: 2, prezzoUnitario: 500 }],
    ...over,
  };
}

test('buildImportItem — mappa raw → item, importo da righe, numeroDisplay', () => {
  const it = buildImportItem(rawBase());
  assert.equal(it.tipoDocumento, 'TD01');
  assert.equal(it.annoProgressivo, 2026);
  assert.equal(it.progressivo, 5);
  assert.equal(it.numeroDisplay, '2026/5');
  assert.equal(it.importo, 1000);
  assert.equal(it.clienteSnapshot.nome, 'ACME Srl');
  assert.equal(it.clienteSnapshot.tipoCliente, 'PG');
});

test('buildImportItem — numero puro: anno dalla data; righe vuote → fallback', () => {
  const it = buildImportItem(rawBase({ numero: '7', data: '2025-06-01', righe: [] }));
  assert.equal(it.annoProgressivo, 2025);
  assert.equal(it.progressivo, 7);
  assert.equal(it.numeroDisplay, '2025/7');
  assert.equal(it.righe.length, 1);
  assert.equal(it.righe[0]!.prezzoUnitario, 1000);
});

test('buildImportItem — cedente estratto dall\'XML fluisce nell\'item (audit C3)', () => {
  const it = buildImportItem(rawBase({ cedente: { partitaIva: '00743110157', idPaese: 'IT', codiceFiscale: 'RSSMRA80A01H501U' } }));
  assert.equal(it.cedentePartitaIva, '00743110157');
  assert.equal(it.cedenteCodiceFiscale, 'RSSMRA80A01H501U');
  // raw senza cedente (payload legacy) → null, sarà il server a rifiutare
  const legacy = buildImportItem(rawBase());
  assert.equal(legacy.cedentePartitaIva, null);
  assert.equal(legacy.cedenteCodiceFiscale, null);
});

test('buildImportItem — importo preso da ImportoTotaleDocumento (per warning server su divergenze)', () => {
  // righe 2×500=1000 ma totale documento 980 (es. sconto ignorato dal parser)
  const it = buildImportItem(rawBase({ importoTotale: 980 }));
  assert.equal(it.importo, 980);
  // senza totale XML → fallback ricalcolo righe
  const it2 = buildImportItem(rawBase({ importoTotale: 0 }));
  assert.equal(it2.importo, 1000);
});

test('buildImportItem — cliente PF (no P.IVA) ed estero', () => {
  const pf = buildImportItem(rawBase({ cliente: { ...rawBase().cliente, denominazione: '', nome: 'Mario', cognome: 'Rossi', partitaIva: '', idCodice: '', codiceFiscale: 'RSSMRA80A01H501U' } }));
  assert.equal(pf.clienteSnapshot.nome, 'Mario Rossi');
  assert.equal(pf.clienteSnapshot.tipoCliente, 'PF');
  const est = buildImportItem(rawBase({ cliente: { ...rawBase().cliente, nazione: 'DE' } }));
  assert.equal(est.clienteSnapshot.tipoCliente, 'Estero');
});
