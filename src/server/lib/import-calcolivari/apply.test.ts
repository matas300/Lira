import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/test-helper';
import { createUserWithDefaultProfile } from '../../lib/users';
import { profiles, pagamenti, clienti } from '../../db/schema';
import { buildImportPlan } from './plan';
import { applyImportPlan } from './apply';
import { OFFICIAL_SAMPLE } from '../../../test-fixtures/calcolivari-sample';

async function seeded() {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  return db;
}

test('applyImportPlan: dry-run non scrive', async () => {
  const db = await seeded();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  await applyImportPlan(db, plan, { commit: false });
  const rows = await db.select().from(pagamenti);
  assert.equal(rows.length, 0);
});

test('applyImportPlan: commit popola DB + profilo creato', async () => {
  const db = await seeded();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  await applyImportPlan(db, plan, { commit: true });
  const [prof] = await db.select().from(profiles).where(eq(profiles.slug, 'mattia'));
  assert.ok(prof);
  const pag = await db.select().from(pagamenti).where(eq(pagamenti.profileId, prof!.id));
  assert.ok(pag.length >= 1);
});

test('applyImportPlan: re-run = no-op (idempotente)', async () => {
  const db = await seeded();
  await applyImportPlan(db, await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' }), { commit: true });
  const plan2 = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  assert.equal(plan2.profileOp, 'identical');
  for (const ep of Object.values(plan2.entities)) {
    assert.equal(ep.inserts.length, 0, `${ep.entity} inserts`);
    assert.equal(ep.updates.length, 0, `${ep.entity} updates`);
  }
});

test('applyImportPlan: fail-closed su issue di validazione', async () => {
  const db = await seeded();
  const plan = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  plan.issues.push({ entity: 'pagamenti', sourceKey: 'x', reason: 'fittizia' });
  await assert.rejects(() => applyImportPlan(db, plan, { commit: true }), /VALIDATION_ISSUES/);
  await applyImportPlan(db, plan, { commit: true, skipInvalid: true });
});

test('applyImportPlan: cliente con id diverso ma stessa P.IVA → riconciliato (no crash, update)', async () => {
  const db = await seeded();
  await applyImportPlan(db, await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' }), { commit: true });
  const renamed = JSON.parse(JSON.stringify(OFFICIAL_SAMPLE));
  renamed['calcoliPIVA_Mattia_clienti'] = [{ id: 'cli-RENUMBERED', nome: 'ACME Spa 2', tipoCliente: 'PG', partitaIva: '99988877766', codiceSDI: 'ABCDEF1' }];
  renamed['calcoliPIVA_Mattia_clienteDefaultId'] = 'cli-RENUMBERED';
  const plan2 = await buildImportPlan(db, [renamed], { userEmail: 'mattia@test.it' });
  assert.equal(plan2.entities['clienti']!.inserts.length, 0); // riconciliato → niente insert
  await applyImportPlan(db, plan2, { commit: true }); // non deve lanciare unique-constraint
  const cls = await db.select().from(clienti).where(eq(clienti.profileId, plan2.profileId));
  assert.equal(cls.length, 1); // un solo cliente, aggiornato non duplicato
  assert.equal(cls[0]!.nome, 'ACME Spa 2');
});
