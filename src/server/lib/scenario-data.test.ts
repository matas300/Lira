// src/server/lib/scenario-data.test.ts
//
// Test per loadScenarioData: lettura dei dati reali (year-settings, fatture
// incassate, pagamenti acconto, anno precedente) e assemblaggio del
// ComparisonInput per buildForfettarioMethodComparison.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from './users';
import { yearSettings, fatture, pagamenti } from '../db/schema';
import { buildScheduleKey } from '@shared/schedule-keys';
import { loadScenarioData } from './scenario-data';

type Db = Awaited<ReturnType<typeof createTestDb>>['db'];

async function seedYearSettings(db: Db, profileId: string, year: number) {
  await db.insert(yearSettings).values({
    profileId,
    year,
    regime: 'forfettario',
    coefficiente: 0.67,
    impostaSostitutiva: 0.15,
    inpsMode: 'artigiani_commercianti',
    inpsCategoria: 'artigiano',
    riduzione35: 0,
    haRedditoDipendente: 0,
    limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
  });
}

async function seedFattura(
  db: Db,
  profileId: string,
  args: { importo: number; data: string; pagAnno: number | null; pagMese: number | null; stato: string },
) {
  await db.insert(fatture).values({
    id: randomUUID(),
    profileId,
    tipoDocumento: 'TD01',
    annoProgressivo: Number(args.data.slice(0, 4)),
    data: args.data,
    righe: JSON.stringify([{ descrizione: 'x', quantita: 1, prezzoUnitario: args.importo }]),
    importo: args.importo,
    stato: args.stato,
    pagAnno: args.pagAnno,
    pagMese: args.pagMese,
  });
}

test('loadScenarioData: somma fatture incassate dell anno + breakdown mensile', async () => {
  const { db } = await createTestDb();
  const { profileId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });

  await seedYearSettings(db, profileId, 2025);
  // 2 fatture incassate nel 2025 (gennaio + marzo), 1 non incassata (pagAnno null).
  await seedFattura(db, profileId, { importo: 10000, data: '2025-01-10', pagAnno: 2025, pagMese: 1, stato: 'pagata' });
  await seedFattura(db, profileId, { importo: 15000, data: '2025-03-05', pagAnno: 2025, pagMese: 3, stato: 'pagata' });
  await seedFattura(db, profileId, { importo: 9999, data: '2025-04-01', pagAnno: null, pagMese: null, stato: 'inviata' });
  // 1 fattura incassata in altro anno (non deve entrare nel 2025).
  await seedFattura(db, profileId, { importo: 5000, data: '2024-12-01', pagAnno: 2024, pagMese: 12, stato: 'pagata' });

  // 1 acconto imposta dell'anno precedente realmente versato (riduce il saldo 2025).
  await db.insert(pagamenti).values({
    id: randomUUID(), profileId, year: 2024,
    data: '2024-11-30', tipo: 'tasse', importo: 300,
    scheduleKey: buildScheduleKey('imposta_acc2', 2024),
  });

  const data = await loadScenarioData(db, profileId, 2025);
  assert.ok(data, 'attesi dati non nulli quando year-settings esistono');
  assert.equal(data!.grossCollected, 25000, 'somma delle 2 fatture incassate 2025');
  // breakdown mensile: gennaio (10000) + marzo (15000).
  assert.equal(data!.monthly.length, 2);
  const byMonth = new Map(data!.monthly.map((m) => [m.month, m.lordo]));
  assert.equal(byMonth.get(1), 10000);
  assert.equal(byMonth.get(3), 15000);
  // comparisonInput pronto per il motore.
  assert.equal(typeof data!.comparisonInput.grossCollected, 'number');
  assert.equal(data!.comparisonInput.grossCollected, 25000);
  assert.equal(data!.comparisonInput.year, 2025);
  assert.equal(data!.comparisonInput.settings.coefficiente, 0.67);
});

test('loadScenarioData: year-settings assenti → null', async () => {
  const { db } = await createTestDb();
  const { profileId } = await createUserWithDefaultProfile({
    db, email: 'm@x.it', password: 'pwd-lunga-12345', name: 'M',
  });
  assert.equal(await loadScenarioData(db, profileId, 1999), null);
});
