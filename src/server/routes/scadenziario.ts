// src/server/routes/scadenziario.ts
//
// Endpoint REST per leggere lo scadenziario fiscale forfettario calcolato
// per `profileId × year`. Wrapper "thin" su `buildScadenziarioView`:
// nessuna logica fiscale qui — solo parsing del param `:year`, autorizzazione
// via `requireSession`, delega al service.
//
// Risposte:
//   200 → `ScadenziarioView` (14 righe + methodComparison + transition + warnings + rulesRef)
//   400 → INVALID_YEAR (param non parseabile o fuori range 2000-2100)
//   401 → UNAUTHENTICATED (middleware `requireSession`)
//   404 → YEAR_SETTINGS_NOT_FOUND (sollevato dal service)

import { Hono } from 'hono';
import { buildScadenziarioView } from '../services/scadenziario-service';
import { requireSession, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';

export const scadenziarioRoute = new Hono<AuthEnv>();

scadenziarioRoute.use('*', requireSession);

scadenziarioRoute.get('/:year', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const yearStr = c.req.param('year');
  const year = parseInt(yearStr, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `anno non valido: ${yearStr}`);
  }
  const view = await buildScadenziarioView({ db, profileId, year });
  return c.json(view);
});
