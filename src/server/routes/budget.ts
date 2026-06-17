// src/server/routes/budget.ts
//
// CRUD del budget per-anno (voci di spesa + mese di riferimento).
//
// GET  /api/budget/:year → { baseMonth: number|null, items: BudgetItem[] }
// PUT  /api/budget/:year  body { baseMonth, items[] } → replace atomico delle
//      voci dell'anno + set budget_base_month su year_settings (se la riga esiste).
//
// L'aliquota effettiva e il nettoAnnuo NON sono qui: vengono da /api/tax/scenario.

import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { BudgetPutInput } from '@shared/schemas';
import { budgetItems, yearSettings } from '../db/schema';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { requireSession, type AuthEnv } from '../middleware/auth';

export const budgetRoute = new Hono<AuthEnv>();
budgetRoute.use('*', requireSession);

type BudgetRow = typeof budgetItems.$inferSelect;

function parseYearParam(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno non valido: "${raw}"`);
  }
  return n;
}

function toPublic(row: BudgetRow) {
  return {
    id: row.id,
    year: row.year,
    nome: row.nome,
    importo: row.importo,
    auto: row.auto === 1,
    ordine: row.ordine,
  };
}

// ─────────────────────────── GET /:year ───────────────────────────

budgetRoute.get('/:year', async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');

  const rows = await db
    .select()
    .from(budgetItems)
    .where(and(eq(budgetItems.profileId, profileId), eq(budgetItems.year, year)))
    .orderBy(asc(budgetItems.ordine));

  const [ys] = await db
    .select({ baseMonth: yearSettings.budgetBaseMonth })
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);

  return c.json({ baseMonth: ys?.baseMonth ?? null, items: rows.map(toPublic) });
});

// ─────────────────────────── PUT /:year ───────────────────────────

budgetRoute.put('/:year', zJson(BudgetPutInput), async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const { baseMonth, items } = c.req.valid('json');
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx
      .delete(budgetItems)
      .where(and(eq(budgetItems.profileId, profileId), eq(budgetItems.year, year)));
    if (items.length > 0) {
      await tx.insert(budgetItems).values(
        items.map((it) => ({
          id: randomUUID(),
          profileId,
          year,
          nome: it.nome,
          importo: it.importo,
          auto: it.auto ? 1 : 0,
          ordine: it.ordine,
          updatedAt: now,
        })),
      );
    }
    await tx
      .update(yearSettings)
      .set({ budgetBaseMonth: baseMonth })
      .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
  });

  const rows = await db
    .select()
    .from(budgetItems)
    .where(and(eq(budgetItems.profileId, profileId), eq(budgetItems.year, year)))
    .orderBy(asc(budgetItems.ordine));
  const [ys] = await db
    .select({ baseMonth: yearSettings.budgetBaseMonth })
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);

  return c.json({ baseMonth: ys?.baseMonth ?? null, items: rows.map(toPublic) });
});
