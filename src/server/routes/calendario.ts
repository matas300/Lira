// src/server/routes/calendario.ts
//
// Endpoint REST per le entry del calendario giornaliero.
//
// GET  /api/calendario/:year       → { year, entries: {month, day, activityCode}[] }
// PUT  /api/calendario/:year/:month/:day  body { activityCode } → upsert
// DELETE /api/calendario/:year/:month/:day → { ok:true } (idempotente)
//
// Solo gli override (codici ≠ default) vengono salvati nel DB; il default
// è calcolato client-side (calendar-defaults.ts). Questo route non conosce
// il default: riceve e persiste qualunque codice valido del set ActivityCodeEnum.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { CalendarEntryInput } from '@shared/schemas';
import { calendarEntries } from '../db/schema';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { requireSession, type AuthEnv } from '../middleware/auth';

export const calendarioRoute = new Hono<AuthEnv>();

calendarioRoute.use('*', requireSession);

// ─────────────────────────── helpers ───────────────────────────

function parseYearParam(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno non valido: "${raw}"`);
  }
  return n;
}

function parseMonthDay(year: number, rawMonth: string, rawDay: string): { month: number; day: number } {
  const month = parseInt(rawMonth, 10);
  const day = parseInt(rawDay, 10);
  if (!Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new HttpError(400, 'INVALID_PARAMS', `Mese/giorno non validi: "${rawMonth}/${rawDay}"`);
  }
  // Cross-check: reject impossible calendar dates (e.g. Feb 31, Apr 31)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    throw new HttpError(400, 'INVALID_DATE', `Data non valida nel calendario: ${year}-${rawMonth}-${rawDay}`);
  }
  return { month, day };
}

// ─────────────────────────── GET /:year ───────────────────────────

calendarioRoute.get('/:year', async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');

  const rows = await db
    .select()
    .from(calendarEntries)
    .where(
      and(
        eq(calendarEntries.profileId, profileId),
        eq(calendarEntries.year, year),
      ),
    );

  const entries = rows.map((r) => ({
    month: r.month,
    day: r.day,
    activityCode: r.activityCode,
  }));

  return c.json({ year, entries });
});

// ─────────────────────────── PUT /:year/:month/:day ───────────────────────────

calendarioRoute.put('/:year/:month/:day', zJson(CalendarEntryInput), async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const { month, day } = parseMonthDay(year, c.req.param('month'), c.req.param('day'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const { activityCode } = c.req.valid('json');

  const now = new Date().toISOString();

  // Upsert: insert or update on PK conflict (profileId, year, month, day)
  await db
    .insert(calendarEntries)
    .values({ profileId, year, month, day, activityCode, updatedAt: now })
    .onConflictDoUpdate({
      target: [calendarEntries.profileId, calendarEntries.year, calendarEntries.month, calendarEntries.day],
      set: { activityCode, updatedAt: now },
    });

  return c.json({ ok: true, entry: { month, day, activityCode } });
});

// ─────────────────────────── DELETE /:year/:month/:day ───────────────────────────

calendarioRoute.delete('/:year/:month/:day', async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const { month, day } = parseMonthDay(year, c.req.param('month'), c.req.param('day'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');

  await db
    .delete(calendarEntries)
    .where(
      and(
        eq(calendarEntries.profileId, profileId),
        eq(calendarEntries.year, year),
        eq(calendarEntries.month, month),
        eq(calendarEntries.day, day),
      ),
    );

  return c.json({ ok: true });
});
