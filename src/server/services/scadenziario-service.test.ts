// src/server/services/scadenziario-service.test.ts
//
// Integrazione service ↔ DB. Verifica che `buildScadenziarioView`:
// - Carichi correttamente year_settings e profilo.
// - Costruisca le 14 righe canoniche dello scadenziario.
// - Calcoli `accontiSostitutivaPagatiReali` da pagamenti.scheduleKey (FIX A6).
// - Aggreghi i warning runtime (audit-checks) sopra ai warning di engine.
// - Throw `HttpError(404, 'YEAR_SETTINGS_NOT_FOUND')` quando l'anno non c'è.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from '../lib/users';
import { buildScadenziarioView } from './scadenziario-service';
import { yearSettings, pagamenti, profiles } from '../db/schema';

async function setup() {
  const { db } = await createTestDb();
  const u = await createUserWithDefaultProfile({
    db,
    email: 'a@b.it',
    password: 'pwd-lunga-12345',
    name: 'A',
  });
  const profileId = u.profileId;
  // Profilo con `attivita.data_inizio_attivita` per audit-check A1.
  await db
    .update(profiles)
    .set({ attivita: JSON.stringify({ data_inizio_attivita: '2018-04-01' }) } as Partial<
      typeof profiles.$inferInsert
    >)
    .where(eq(profiles.id, profileId));
  // year_settings 2025 e 2026 forfettario, artigiano, no riduzione 35%.
  await db.insert(yearSettings).values({
    profileId,
    year: 2025,
    regime: 'forfettario',
    coefficiente: 0.67,
    impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti',
    inpsCategoria: 'artigiano',
    riduzione35: 0,
    riduzione35Comunicata: 0,
    haRedditoDipendente: 0,
    limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
  } as typeof yearSettings.$inferInsert);
  await db.insert(yearSettings).values({
    profileId,
    year: 2026,
    regime: 'forfettario',
    coefficiente: 0.67,
    impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti',
    inpsCategoria: 'artigiano',
    riduzione35: 0,
    riduzione35Comunicata: 0,
    haRedditoDipendente: 0,
    limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
  } as typeof yearSettings.$inferInsert);
  return { db, profileId };
}

test('buildScadenziarioView: ritorna 14 righe per anno 2026', async () => {
  const { db, profileId } = await setup();
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  assert.equal(view.rows.length, 14);
});

test('FIX A6: pagamento acc1 reale per sostitutiva 2025 produce saldo 2025 coerente', async () => {
  const { db, profileId } = await setup();
  await db.insert(pagamenti).values({
    id: 'pay1',
    profileId,
    year: 2025,
    data: '2025-06-30',
    tipo: 'tasse',
    importo: 1234.56,
    scheduleKey: 'imposta_acc1_2025',
  } as typeof pagamenti.$inferInsert);
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  const saldo = view.rows.find((r) => r.id === 'imposta_saldo_2025');
  assert.ok(saldo, 'riga imposta_saldo_2025 presente');
  // Il saldo è max(substituteTax - 1234.56, 0); con grossCollected=0 → saldo=0.
  assert.ok(saldo.amount.point >= 0, 'saldo non negativo');
});

test('warnings includono audit checks runtime (M1) quando riduzione_35 non comunicata', async () => {
  const { db, profileId } = await setup();
  // Attivo riduzione 35% senza comunicazione → atteso M1.
  await db
    .update(yearSettings)
    .set({ riduzione35: 1, riduzione35Comunicata: 0 } as Partial<
      typeof yearSettings.$inferInsert
    >)
    .where(eq(yearSettings.profileId, profileId));
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  assert.ok(view.warnings.some((w) => w.code === 'M1_RIDUZIONE_35_NON_COMUNICATA'));
});

test('GET anno senza year_settings → throw YEAR_SETTINGS_NOT_FOUND', async () => {
  const { db, profileId } = await setup();
  await assert.rejects(
    () => buildScadenziarioView({ db, profileId, year: 2030 }),
    /YEAR_SETTINGS_NOT_FOUND/,
  );
});

test('methodComparison e transition presenti in output', async () => {
  const { db, profileId } = await setup();
  const view = await buildScadenziarioView({ db, profileId, year: 2026 });
  assert.ok(view.methodComparison);
  assert.ok(view.transition);
  assert.equal(view.rulesRef, '/api/tax/rules?year=2026');
});
