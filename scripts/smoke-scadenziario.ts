// scripts/smoke-scadenziario.ts
//
// Smoke E2E del modulo fiscale Slice 2A: crea un DB temporaneo, inserisce un
// utente + profilo + year_settings 2026 + una fattura pagata, poi invoca
// `buildScadenziarioView` e stampa il riassunto JSON delle 13 righe canoniche.
//
// Esecuzione: `npx tsx scripts/smoke-scadenziario.ts`
//
// Output atteso: JSON con `rowsCount: 13`, l'elenco delle righe (id, dueDate,
// amount, status) e il summary aggregato (totalDue/totalPaid/totalResidual).
// Esce con code 0 in caso di successo, code 1 se qualcosa non torna (es. il
// numero di righe non è 13 o `buildScadenziarioView` solleva).
//
// Lo script è autosufficiente: non legge `.env`, non si collega a Turso, non
// avvia il server Hono. Usa `createTestDb()` per un libSQL file://tmp.

import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../src/server/db/test-helper';
import { createUserWithDefaultProfile } from '../src/server/lib/users';
import { yearSettings, fatture, profiles } from '../src/server/db/schema';
import { buildScadenziarioView } from '../src/server/services/scadenziario-service';

async function main(): Promise<void> {
  const { db } = await createTestDb();

  const { profileId } = await createUserWithDefaultProfile({
    db,
    email: 'smoke@x.it',
    password: 'pwd-lunga-12345',
    name: 'Smoke',
  });

  // Profilo con data_inizio_attivita: serve per l'audit-check A1 (5% startup).
  await db
    .update(profiles)
    .set({
      attivita: JSON.stringify({ data_inizio_attivita: '2018-04-01' }),
    } as Partial<typeof profiles.$inferInsert>)
    .where(eq(profiles.id, profileId));

  // Year settings 2026: forfettario, artigiano, 0.67 (gruppo F), 15% standard.
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

  // Una fattura del 2026 di 5.000 €, marcata come incassata in aprile 2026
  // (pag_anno=2026, pag_mese=4): contribuisce a `grossCollected`.
  await db.insert(fatture).values({
    id: randomUUID(),
    profileId,
    tipoDocumento: 'TD01',
    annoProgressivo: 2026,
    progressivo: 1,
    numeroDisplay: '2026/001',
    data: '2026-03-15',
    righe: JSON.stringify([
      { descrizione: 'consulenza', quantita: 1, prezzo_unitario: 5000 },
    ]),
    importo: 5000,
    pagAnno: 2026,
    pagMese: 4,
    stato: 'pagata',
  } as typeof fatture.$inferInsert);

  const view = await buildScadenziarioView({ db, profileId, year: 2026 });

  const out = {
    rowsCount: view.rows.length,
    method: view.method,
    rows: view.rows.map((r) => ({
      id: r.id,
      dueDate: r.dueDate,
      amount: r.amount.point,
      status: r.status.code,
    })),
    warnings: view.warnings.map((w) => w.code),
    summary: {
      totalDue: view.summary.totalDue,
      totalPaid: view.summary.totalPaid,
      totalResidual: view.summary.totalResidual,
      nextDueId: view.summary.nextDue?.id ?? null,
    },
  };

  console.log(JSON.stringify(out, null, 2));

  if (view.rows.length !== 13) {
    console.error(`\n[smoke] FAIL: expected 13 rows, got ${view.rows.length}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
