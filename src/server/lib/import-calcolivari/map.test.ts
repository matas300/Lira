import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from './detect';
import { extractAll } from './extract';
import { mapAll } from './map';

const CTX = { profileId: 'prof-1', userId: 'user-1', slug: 'mattia' };

function sample() {
  return {
    'calcoliPIVA_Mattia_2025': {
      settings: { regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata', limiteForfettario: 85000 },
      pagamenti: [{ data: '2025-06-30', tipo: 'tasse', importo: 900, scheduleKey: 'imposta_acc1_2025' }],
    },
    'calcoliPIVA_Mattia_clienti': [{ id: 'cli1', nome: 'ACME', partitaIva: 'IT999' }],
    'calcoliPIVA_Mattia_clienteDefaultId': 'cli1',
    'calcoliPIVA_Mattia_fattureEmesse': [
      { id: 'fat1', annoProgressivo: 2025, progressivo: 7, data: '2025-03-01', totaleLordo: 1500, righe: [{ descrizione: 'Dev', quantita: 1, prezzoUnitario: 1500, iva: 0 }], stato: 'pagata' },
    ],
    'calcoliPIVA_profile_Mattia': { nome: 'Mattia' },
  };
}

test('mapAll: year_settings normalizza coefficiente %→frazione', () => {
  const { rows, issues } = mapAll(extractAll(detect(sample())), CTX);
  assert.equal(issues.length, 0);
  const ys = rows.yearSettings[0]!;
  assert.equal(ys.coefficiente, 0.67);
  assert.equal(ys.impostaSostitutiva, 0.05);
  assert.equal(ys.profileId, 'prof-1');
});

test('mapAll: cliente riusa id CalcoliVari e setta is_default', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  assert.equal(rows.clienti[0]!.id, 'cli1');
  assert.equal(rows.clienti[0]!.isDefault, 1);
});

test('mapAll: pagamento id deterministico + year da scheduleKey', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  const p = rows.pagamenti[0]!;
  assert.equal(p.year, 2025);
  assert.match(p.id, /^[0-9a-f]{8}-/);
});

test('mapAll: fattura numero_display in convenzione Lira YYYY/NNN', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  assert.equal(rows.fatture[0]!.numeroDisplay, '2025/7');
  assert.equal(rows.fatture[0]!.importo, 1500);
});

test('mapAll: profilo con anagrafica/attività JSON valido', () => {
  const { rows } = mapAll(extractAll(detect(sample())), CTX);
  const prof = rows.profiles[0]!;
  assert.equal(prof.slug, 'mattia');
  assert.equal(JSON.parse(prof.anagrafica!).nome, 'Mattia');
});

test('mapAll: riga invalida → ImportIssue, non in rows', () => {
  const bad = { 'calcoliPIVA_Mattia_2025': { settings: { regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata' }, pagamenti: [{ data: '', tipo: '', importo: 'x' }] } };
  const { rows, issues } = mapAll(extractAll(detect(bad)), CTX);
  assert.equal(rows.pagamenti.length, 0);
  assert.ok(issues.some((i) => i.entity === 'pagamenti'));
});
