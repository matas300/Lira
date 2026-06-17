// src/server/routes/dichiarazione.ts
//
// GET /api/dichiarazione/:year — dichiarazione PF forfettaria (read-only, 6A).
// Orchestrazione I/O: carica lo scenario reale (come /api/tax/scenario) + profilo
// + year-settings, poi delega al motore puro `buildDichiarazione`. La verità
// fiscale è server-side; il client solo presenta.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { profiles, yearSettings } from '../db/schema';
import { requireSession, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { loadScenarioData } from '../lib/scenario-data';
import { buildForfettarioMethodComparison } from '../lib/tax-engine';
import {
  buildDichiarazione,
  type DichiarazioneAnagrafica,
  type DichiarazioneYsView,
} from '../lib/dichiarazione-engine';

export const dichiarazioneRoute = new Hono<AuthEnv>();
dichiarazioneRoute.use('*', requireSession);

function parseBlob(v: string | null): Record<string, unknown> {
  if (!v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch { return {}; }
}

function resolveYear(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno "${raw}" non valido.`);
  }
  return n;
}

dichiarazioneRoute.get('/:year', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const year = resolveYear(c.req.param('year'));

  // loadScenarioData ritorna null se le year-settings dell'anno mancano → needsConfig.
  const data = await loadScenarioData(db, profileId, year);
  if (!data) return c.json({ year, needsConfig: true });

  // Le year-settings esistono (loadScenarioData non-null): leggo la riga per la ys view.
  const [ysRow] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);
  if (!ysRow) return c.json({ year, needsConfig: true });

  const selected = buildForfettarioMethodComparison(data.comparisonInput).selected;

  const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!prof) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');
  const anagrafica = parseBlob(prof.anagrafica) as DichiarazioneAnagrafica;
  const attivita = parseBlob(prof.attivita) as { data_inizio_attivita?: string };

  const ys: DichiarazioneYsView = {
    regime: ysRow.regime,
    inpsMode: ysRow.inpsMode,
    impostaSostitutiva: Number(ysRow.impostaSostitutiva),
    coefficiente: Number(ysRow.coefficiente),
    limiteForfettario: Number(ysRow.limiteForfettario ?? 85000),
  };

  const dichiarazione = buildDichiarazione({
    year, scenario: selected, ys, anagrafica,
    dataInizioAttivita: attivita.data_inizio_attivita,
  });

  return c.json({ year, needsConfig: false, dichiarazione });
});
