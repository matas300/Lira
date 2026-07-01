// src/server/lib/storico-base.test.ts
//
// Test per loadStoricoPriorSeeds: derivazione della base acconti storico
// (imposta + contributi variabili DOVUTI l'anno precedente) dallo storico
// fatture, con fallback ai campi manuali quando l'anno precedente non è
// tracciato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/test-helper';
import { createUserWithDefaultProfile } from './users';
import { yearSettings, fatture } from '../db/schema';
import { getInpsArtComForYear } from '@shared/inps-params';
import { FORFETTARIO_RULES } from '@shared/forfettario-rules';
import { loadStoricoPriorSeeds, type BuildContribParams } from './storico-base';

type Db = Awaited<ReturnType<typeof createTestDb>>['db'];
type YsRow = typeof yearSettings.$inferSelect;

// Replica il buildContributionParams dei consumer (quota fissa artigiano/
// commerciante dalla tabella INPS, × 0.65 se riduzione 35%).
const buildContrib: BuildContribParams = (ys, year, saldoAccontoBase) => {
  if (!ys || ys.inpsMode !== 'artigiani_commercianti') {
    return { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase };
  }
  let quota = 0;
  try {
    const p = getInpsArtComForYear(year);
    quota = ys.inpsCategoria === 'commerciante' ? p.quotaFissaAnnuaCommerciante : p.quotaFissaAnnuaArtigiano;
  } catch {
    quota = 0;
  }
  const rid = ys.riduzione35 === 1 ? FORFETTARIO_RULES.riduzioneInpsCoefficiente : 1;
  return {
    mode: 'artigiani_commercianti',
    fixedAnnual: quota * rid,
    saldoAccontoBase,
    categoria: ys.inpsCategoria === 'commerciante' ? 'commerciante' : 'artigiano',
  };
};

async function seedYs(db: Db, profileId: string, year: number, extra: Partial<typeof yearSettings.$inferInsert> = {}) {
  await db.insert(yearSettings).values({
    profileId,
    year,
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
    ...extra,
  } as typeof yearSettings.$inferInsert);
}

async function seedFattura(db: Db, profileId: string, importo: number, pagAnno: number | null) {
  const anno = pagAnno ?? 2000;
  await db.insert(fatture).values({
    id: randomUUID(),
    profileId,
    tipoDocumento: 'TD01',
    annoProgressivo: anno,
    data: `${anno}-03-01`,
    righe: JSON.stringify([{ descrizione: 'x', quantita: 1, prezzoUnitario: importo }]),
    importo,
    stato: pagAnno ? 'pagata' : 'inviata',
    pagAnno,
    pagMese: pagAnno ? 3 : null,
  } as typeof fatture.$inferInsert);
}

async function getYs(db: Db, profileId: string, year: number): Promise<YsRow> {
  const rows = await db.select().from(yearSettings).where(eq(yearSettings.profileId, profileId));
  const row = rows.find((r) => r.year === year);
  assert.ok(row, `year_settings ${year} attese`);
  return row;
}

test('deriva la base imposta+contributi dall anno precedente tracciato (fatture)', async () => {
  const { db } = await createTestDb();
  const { profileId } = await createUserWithDefaultProfile({
    db, email: 'a@x.it', password: 'pwd-lunga-12345', name: 'A',
  });
  await seedYs(db, profileId, 2024);
  await seedYs(db, profileId, 2025);
  // 30.000 € incassati nel 2024.
  await seedFattura(db, profileId, 30000, 2024);

  const ys2025 = await getYs(db, profileId, 2025);
  const seeds = await loadStoricoPriorSeeds(db, profileId, 2025, ys2025, buildContrib);

  // Ricostruzione attesa (metodo storico, motore):
  //  redditoLordo 2024 = 30000*0.67 = 20100
  //  quota fissa artigiano 2024 = 4427.04 → 3 rate nell'anno = 3320.28 deducibili
  //  imponibile = 20100-3320.28 = 16779.72 → imposta 15% = 2516.96
  //  variabili = 0.24*(20100-18415) = 404.40
  assert.equal(seeds.computedFromInvoices, true);
  assert.equal(seeds.previousTaxBase, 2516.96);
  assert.equal(seeds.previousContribVariabili, 404.4);
});

test('anno precedente NON tracciato → fallback ai campi manuali primoAnno*Prec', async () => {
  const { db } = await createTestDb();
  const { profileId } = await createUserWithDefaultProfile({
    db, email: 'b@x.it', password: 'pwd-lunga-12345', name: 'B',
  });
  // Solo 2025 (il 2024 non esiste): usa i carry-in manuali su ys(2025).
  await seedYs(db, profileId, 2025, {
    primoAnnoImpostaPrec: 1800,
    primoAnnoContribVariabiliPrec: 250,
  });
  await seedFattura(db, profileId, 40000, 2025);

  const ys2025 = await getYs(db, profileId, 2025);
  const seeds = await loadStoricoPriorSeeds(db, profileId, 2025, ys2025, buildContrib);

  assert.equal(seeds.computedFromInvoices, false);
  assert.equal(seeds.previousTaxBase, 1800);
  assert.equal(seeds.previousContribVariabili, 250);
});

test('anno precedente non tracciato e nessun carry-in → 0', async () => {
  const { db } = await createTestDb();
  const { profileId } = await createUserWithDefaultProfile({
    db, email: 'c@x.it', password: 'pwd-lunga-12345', name: 'C',
  });
  await seedYs(db, profileId, 2025);

  const ys2025 = await getYs(db, profileId, 2025);
  const seeds = await loadStoricoPriorSeeds(db, profileId, 2025, ys2025, buildContrib);

  assert.equal(seeds.computedFromInvoices, false);
  assert.equal(seeds.previousTaxBase, 0);
  assert.equal(seeds.previousContribVariabili, 0);
});

test('catena di 3 anni: la base 2026 = imposta 2025 derivata dallo storico', async () => {
  const { db } = await createTestDb();
  const { profileId } = await createUserWithDefaultProfile({
    db, email: 'd@x.it', password: 'pwd-lunga-12345', name: 'D',
  });
  await seedYs(db, profileId, 2024);
  await seedYs(db, profileId, 2025);
  await seedYs(db, profileId, 2026);
  await seedFattura(db, profileId, 30000, 2024);
  await seedFattura(db, profileId, 45000, 2025);

  const ys2026 = await getYs(db, profileId, 2026);
  const seeds = await loadStoricoPriorSeeds(db, profileId, 2026, ys2026, buildContrib);

  // La base 2026 deve derivare dal 2025 (fatture 45k), quindi > della sola 2024.
  assert.equal(seeds.computedFromInvoices, true);
  assert.ok(seeds.previousTaxBase > 2516.96, 'imposta 2025 (45k) > imposta 2024 (30k)');
  assert.ok(seeds.previousContribVariabili > 404.4, 'variabili 2025 > variabili 2024');
});
