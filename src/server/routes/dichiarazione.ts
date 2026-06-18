// src/server/routes/dichiarazione.ts
//
// GET /api/dichiarazione/:year — dichiarazione PF forfettaria (read-only, 6A/6B).
// PATCH /api/dichiarazione/:year — rettifiche manuali 6C (acconti/crediti/credito
// anno precedente) persistite nel campo `overrides` JSON di year_settings sotto
// la chiave `dichiarazione`, con merge non-distruttivo (preserva gli override
// dello scadenziario / confirmedWarnings).
//
// Orchestrazione I/O: carica lo scenario reale (come /api/tax/scenario) + profilo
// + year-settings, poi delega al motore puro `buildDichiarazione`. La verità
// fiscale è server-side; il client solo presenta.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { profiles, yearSettings } from '../db/schema';
import { requireSession, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { loadScenarioData } from '../lib/scenario-data';
import { buildForfettarioMethodComparison } from '../lib/tax-engine';
import {
  buildDichiarazione,
  type DichiarazioneAnagrafica,
  type DichiarazioneYsView,
  type DichiarazioneOverridesInput,
} from '../lib/dichiarazione-engine';
import type { Db } from '../db/client';

export const dichiarazioneRoute = new Hono<AuthEnv>();
dichiarazioneRoute.use('*', requireSession);

function parseBlob(v: string | null): Record<string, unknown> {
  if (!v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch { return {}; }
}

function parseYearParam(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno "${raw}" non valido.`);
  }
  return n;
}

/**
 * Estrae le rettifiche manuali 6C dal campo `overrides` JSON di year_settings
 * (sotto-chiave `dichiarazione`). Parse difensivo: numeri ammessi, `null`
 * esplicito (→ default nel motore), tutto il resto ignorato.
 */
function readDichiarazioneOverrides(raw: string | null): DichiarazioneOverridesInput {
  const o = parseBlob(raw);
  const d = (o.dichiarazione && typeof o.dichiarazione === 'object' && !Array.isArray(o.dichiarazione))
    ? (o.dichiarazione as Record<string, unknown>) : {};
  const num = (v: unknown): number | null | undefined =>
    typeof v === 'number' ? v : v === null ? null : undefined;
  return { accontiVersati: num(d.accontiVersati), creditiImposta: num(d.creditiImposta), creditoAnnoPrec: num(d.creditoAnnoPrec) };
}

/**
 * Carica scenario + profilo + year-settings e costruisce la dichiarazione.
 * Condiviso da GET e PATCH per garantire una risposta identica (DRY).
 */
async function loadDichiarazioneResponse(db: Db, profileId: string, year: number) {
  const data = await loadScenarioData(db, profileId, year);
  if (!data) return { year, needsConfig: true as const };

  const [ysRow] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year))).limit(1);
  if (!ysRow) return { year, needsConfig: true as const };

  // La dichiarazione è un documento CONSUNTIVO: uso lo scenario storico
  // (reddito/imposta/contributi effettivi dell'anno), non il previsionale.
  const scenario = buildForfettarioMethodComparison(data.comparisonInput).historical;

  const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!prof) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');
  const anagrafica = parseBlob(prof.anagrafica) as DichiarazioneAnagrafica;
  const attivita = parseBlob(prof.attivita) as { data_inizio_attivita?: string };

  const ys: DichiarazioneYsView = {
    regime: ysRow.regime,
    inpsMode: ysRow.inpsMode,
    inpsCategoria: ysRow.inpsCategoria ?? null,
    impostaSostitutiva: Number(ysRow.impostaSostitutiva),
    coefficiente: Number(ysRow.coefficiente),
    limiteForfettario: Number(ysRow.limiteForfettario ?? 85000),
    prorogaSaldoAt: ysRow.prorogaSaldoAt ?? null,
  };

  const dichiarazione = buildDichiarazione({
    year, scenario, ys, anagrafica,
    dataInizioAttivita: attivita.data_inizio_attivita,
    overrides: readDichiarazioneOverrides(ysRow.overrides),
  });
  return { year, needsConfig: false as const, dichiarazione };
}

dichiarazioneRoute.get('/:year', async (c) => {
  const year = parseYearParam(c.req.param('year'));
  return c.json(await loadDichiarazioneResponse(c.get('db'), c.get('activeProfileId'), year));
});

// ─────────────────────────── PATCH /:year (rettifiche 6C) ───────────────────────────

const OverridesPatchInput = z.object({
  accontiVersati: z.number().nonnegative().nullable().optional(),
  creditiImposta: z.number().nonnegative().nullable().optional(),
  creditoAnnoPrec: z.number().nonnegative().nullable().optional(),
});

dichiarazioneRoute.patch('/:year', zValidator('json', OverridesPatchInput), async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = parseYearParam(c.req.param('year'));
  const patch = c.req.valid('json');

  const [row] = await db.select().from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year))).limit(1);
  if (!row) throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND', `Impostazioni anno ${year} non trovate`);

  // parse difensivo dell'overrides JSON esistente (preserva gli override scadenziario)
  let overrides: Record<string, unknown> = {};
  if (row.overrides) {
    try {
      const parsed = JSON.parse(row.overrides) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) overrides = parsed as Record<string, unknown>;
    } catch { overrides = {}; }
  }
  const dich: Record<string, unknown> = (overrides.dichiarazione && typeof overrides.dichiarazione === 'object' && !Array.isArray(overrides.dichiarazione))
    ? (overrides.dichiarazione as Record<string, unknown>) : {};

  for (const k of ['accontiVersati', 'creditiImposta', 'creditoAnnoPrec'] as const) {
    if (!(k in patch)) continue;          // non fornito → invariato
    const v = patch[k];
    if (v === null) delete dich[k];        // null → torna al default
    else dich[k] = v;
  }
  overrides.dichiarazione = dich;

  await db.update(yearSettings).set({ overrides: JSON.stringify(overrides) })
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));

  return c.json(await loadDichiarazioneResponse(db, profileId, year));
});
