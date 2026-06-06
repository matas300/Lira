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
