import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from './detect';
import { extractAll } from './extract';

const SAMPLE = {
  'calcoliPIVA_Mattia_2024': {
    settings: { regime: 'forfettario', coefficiente: 67, anagrafica: { nome: 'Mattia', codiceFiscale: 'CF24' }, attivita: { partitaIva: 'IT123' } },
    pagamenti: [{ data: '2024-06-30', tipo: 'tasse', descrizione: 'saldo', importo: 500, scheduleKey: 'imposta_saldo_2023' }],
    budget: [{ nome: 'Tasse', importo: 1000, auto: true }],
    spese: [{ titolo: 'PC', costo: 800, deducibilita: 1, anni: 1 }],
    calendar: { '3-15': 'F', '6-1': '' },
    lmQuadro: { overrides: { LM_x: 5 } },
    _fattureManualeWipedBackup: { '5': [{ importo: 300, desc: 'vecchia', pagMese: 5, pagAnno: 2024 }] },
  },
  'calcoliPIVA_Mattia_2025': {
    settings: { regime: 'forfettario', coefficiente: 67, anagrafica: { cognome: 'Rossi' } },
    pagamenti: [{ data: '2025-06-30', tipo: 'tasse', importo: 900, scheduleKey: 'imposta_acc1_2025' }],
    dichiarazione: { tipoDichiarazione: 'ordinaria', overrides: { LM_y: 2 }, contiEsteri: [] },
  },
  'calcoliPIVA_Mattia_fattureEmesse': [
    { id: 'fat1', anno: 2025, annoProgressivo: 2025, progressivo: 7, numero: '7/2025', data: '2025-03-01', tipoDocumento: 'TD01', totaleLordo: 1500, righe: [{ descrizione: 'Dev', quantita: 1, prezzoUnitario: 1500, iva: 0 }], stato: 'pagata', origine: 'wizard' },
  ],
  'calcoliPIVA_Mattia_clienti': [{ id: 'cli1', nome: 'ACME', tipoCliente: 'PG', partitaIva: 'IT999' }],
  'calcoliPIVA_Mattia_clienteDefaultId': 'cli1',
  'calcoliPIVA_Mattia_giorniIncasso': 45,
  'calcoliPIVA_profile_Mattia': { nome: 'Mattia', partitaIva: 'IT123', ateco: '62.01.00' },
};

test('extractAll: anagrafica/attività merge multi-anno + fiscal', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.anagrafica.nome, 'Mattia');
  assert.equal(ex.anagrafica.cognome, 'Rossi');
  assert.equal(ex.giorniIncasso, 45);
});

test('extractAll: pagamenti cross-year raccolti da tutti gli anni', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.pagamenti.length, 2);
  assert.deepEqual(ex.pagamenti.map((p) => p.year).sort(), [2024, 2025]);
});

test('extractAll: fattura canonica + legacy da _fattureManualeWipedBackup', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.fatture.length, 2);
  const legacy = ex.fatture.find((f) => f.origine === 'legacy-migrated');
  assert.ok(legacy);
  assert.equal(legacy!.importo, 300);
  assert.ok(legacy!.progressivo >= 9000);
});

test('extractAll: calendar sparso, code vuoto scartato', () => {
  const ex = extractAll(detect(SAMPLE));
  assert.equal(ex.calendar.length, 1);
  assert.deepEqual(ex.calendar[0], { year: 2024, month: 3, day: 15, code: 'F' });
});

test('extractAll: lmQuadro legacy → dichiarazione overrides', () => {
  const ex = extractAll(detect(SAMPLE));
  const d2024 = ex.dichiarazioni.find((d) => d.year === 2024);
  assert.deepEqual(d2024!.dichiarazione.overrides, { LM_x: 5 });
});
