import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../../db/test-helper';
import { createUserWithDefaultProfile } from '../../lib/users';
import { profiles, pagamenti, fatture, clienti, yearSettings, budgetItems, spese, calendarEntries, dichiarazioni } from '../../db/schema';
import { buildImportPlan } from './plan';
import { applyImportPlan } from './apply';
import { OFFICIAL_SAMPLE, WRAPPER_SAMPLE } from '../../../test-fixtures/calcolivari-sample';

async function run(input: unknown) {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  const plan = await buildImportPlan(db, [input], { userEmail: 'mattia@test.it' });
  await applyImportPlan(db, plan, { commit: true });
  const [prof] = await db.select().from(profiles).where(eq(profiles.slug, 'mattia'));
  return { db, profileId: prof!.id };
}

test('E2E ufficiale: tutte le 9 entità popolate con i conteggi attesi', async () => {
  const { db, profileId } = await run(OFFICIAL_SAMPLE);
  const count = async (t: any) => (await db.select().from(t).where(eq(t.profileId, profileId))).length;
  assert.equal(await count(yearSettings), 2);
  assert.equal(await count(clienti), 1);
  assert.equal(await count(fatture), 2);
  assert.equal(await count(pagamenti), 3);
  assert.equal(await count(budgetItems), 2);
  assert.equal(await count(spese), 1);
  assert.equal(await count(calendarEntries), 2);
  assert.equal(await count(dichiarazioni), 2);
});

test('E2E: pagamenti competenza da scheduleKey (anno corretto)', async () => {
  const { db, profileId } = await run(OFFICIAL_SAMPLE);
  const rows = await db.select().from(pagamenti).where(eq(pagamenti.profileId, profileId));
  const saldo = rows.find((r) => r.scheduleKey === 'imposta_saldo_2023');
  assert.equal(saldo!.year, 2023);
});

test('E2E backup-wrapper: stesso risultato dell ufficiale', async () => {
  const { db, profileId } = await run(WRAPPER_SAMPLE);
  const fat = await db.select().from(fatture).where(eq(fatture.profileId, profileId));
  assert.equal(fat.length, 2);
});

test('E2E idempotenza: secondo import = no-op', async () => {
  const { db } = await createTestDb();
  await createUserWithDefaultProfile({ db, email: 'mattia@test.it', password: 'pw-lunga-1234', name: 'Mattia' });
  await applyImportPlan(db, await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' }), { commit: true });
  const plan2 = await buildImportPlan(db, [OFFICIAL_SAMPLE], { userEmail: 'mattia@test.it' });
  const totalWrites = Object.values(plan2.entities).reduce((s, ep) => s + ep.inserts.length + ep.updates.length, 0);
  assert.equal(totalWrites, 0);
  assert.equal(plan2.profileOp, 'identical');
});
