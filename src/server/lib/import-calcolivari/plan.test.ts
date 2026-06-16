import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../../db/test-helper';
import { createUserWithDefaultProfile } from '../../lib/users';
import { buildImportPlan } from './plan';
import { OFFICIAL_SAMPLE } from '../../../test-fixtures/calcolivari-sample';

async function seed() {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  return db;
}

test('buildImportPlan: USER_NOT_FOUND se email assente', async () => {
  const { db } = await createTestDb();
  await assert.rejects(() => buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'ghost@x.it' }), /USER_NOT_FOUND/);
});

test('buildImportPlan: profilo nuovo → profileOp insert, child tutti insert', async () => {
  const db = await seed();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  assert.equal(plan.profileOp, 'insert');
  assert.equal(plan.slug, 'mattia');
  assert.ok(plan.entities['pagamenti']!.inserts.length >= 1);
  assert.equal(plan.entities['pagamenti']!.updates.length, 0);
});

test('buildImportPlan: merge longest-wins su due file', async () => {
  const db = await seed();
  const richer = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE));
  richer['calcoliPIVA_Mattia_clienti'] = [{ id: 'cli1', nome: 'ACME SRL', partitaIva: 'IT999', pec: 'a@pec.it' }];
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE, richer], { userEmail: 'mattia@test.it' });
  const cli = plan.entities['clienti']!.inserts.find((c: any) => c.id === 'cli1');
  assert.equal(cli.pec, 'a@pec.it');
});

test('buildImportPlan: clienti duplicati (stessa P.IVA) unificati, clienteId fatture rimappato', async () => {
  const db = await seed();
  const exp = {
    profile: 'Mattia',
    keys: {
      'calcoliPIVA_Mattia_clienti': [
        { id: 'c1', nome: 'ACME SRL', partitaIva: 'IT123' },
        { id: 'c2', nome: 'ACME SRL', partitaIva: 'IT123', pec: 'a@pec.it' }, // stesso cliente, più ricco
      ],
      'calcoliPIVA_Mattia_fattureEmesse': [
        { id: 'f1', annoProgressivo: 2024, progressivo: 0, data: '2024-01-01', totaleLordo: 100, clienteId: 'c1', righe: [] },
        { id: 'f2', annoProgressivo: 2024, progressivo: 0, data: '2024-02-01', totaleLordo: 200, clienteId: 'c2', righe: [] },
      ],
    },
  };
  const plan = await buildImportPlan(db, [exp], { userEmail: 'mattia@test.it' });
  assert.equal(plan.entities['clienti']!.inserts.length, 1, 'i due clienti con stessa P.IVA sono unificati');
  const kept = plan.entities['clienti']!.inserts[0];
  assert.equal(kept.pec, 'a@pec.it', 'sopravvive il record più ricco');
  const f = plan.entities['fatture']!.inserts;
  assert.equal(f.length, 2);
  assert.ok(f.every((x: any) => x.clienteId === kept.id), 'tutte le fatture puntano al cliente sopravvissuto');
});

test('buildImportPlan: fatture distinte con stesso progressivo (es. 0) sono rinumerate per anno/data, nessuna persa', async () => {
  const db = await seed();
  // 3 fatture 2024 + 2 fatture 2025, tutte con progressivo 0 (come i dati legacy reali).
  // Devono sopravvivere tutte, rinumerate 1..N per anno ordinando per data.
  const exp = {
    profile: 'Mattia',
    keys: {
      'calcoliPIVA_Mattia_fattureEmesse': [
        { id: 'f-mar', annoProgressivo: 2024, progressivo: 0, data: '2024-03-01', totaleLordo: 300, righe: [] },
        { id: 'f-gen', annoProgressivo: 2024, progressivo: 0, data: '2024-01-15', totaleLordo: 100, righe: [] },
        { id: 'f-feb', annoProgressivo: 2024, progressivo: 0, data: '2024-02-10', totaleLordo: 200, righe: [] },
        { id: 'f-2025b', annoProgressivo: 2025, progressivo: 0, data: '2025-06-01', totaleLordo: 600, righe: [] },
        { id: 'f-2025a', annoProgressivo: 2025, progressivo: 0, data: '2025-02-01', totaleLordo: 500, righe: [] },
      ],
    },
  };
  const plan = await buildImportPlan(db, [exp], { userEmail: 'mattia@test.it' });
  const ins = plan.entities['fatture']!.inserts;
  assert.equal(ins.length, 5, 'tutte le 5 fatture devono sopravvivere');

  // lookup per importo (gli id vengono namespaced per profilo, vedi map.ts)
  const byImp = new Map(ins.map((f: any) => [f.importo, f]));
  // 2024: gen(100)→1, feb(200)→2, mar(300)→3
  assert.equal(byImp.get(100).progressivo, 1);
  assert.equal(byImp.get(200).progressivo, 2);
  assert.equal(byImp.get(300).progressivo, 3);
  assert.equal(byImp.get(300).numeroDisplay, '2024/3');
  // 2025: feb(500)→1, giu(600)→2
  assert.equal(byImp.get(500).progressivo, 1);
  assert.equal(byImp.get(600).progressivo, 2);
  // chiavi (anno:progressivo) tutte uniche → niente collisione col vincolo unique
  const keys = ins.map((f: any) => `${f.annoProgressivo}:${f.progressivo}`);
  assert.equal(new Set(keys).size, keys.length);
});
