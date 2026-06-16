// src/server/routes/year-settings.ts
//
// Endpoint REST per le impostazioni fiscali annuali (year_settings).
// Boundary checks (Task 16):
//  - regime !== 'forfettario' → 422 REGIME_NOT_SUPPORTED (lo slice 2A copre
//    solo il forfettario; ordinario arriverà in slice futuri).
//  - coefficiente non in {0.40, 0.54, 0.62, 0.67, 0.78, 0.86} → 422
//    COEFFICIENTE_NON_AMMESSO (DM 23/01/2015).
//  - impostaSostitutiva === 0.05 ma data_inizio_attivita del profilo è oltre i
//    5 periodi d'imposta → 422 INVALID_SOSTITUTIVA_5 (fix A1, art. 1 c. 65
//    L. 190/2014).
//  - prorogaSaldoAt valorizzata ma non in luglio → 422 PROROGA_FUORI_LUGLIO
//    (la proroga ufficiale del saldo è sempre di luglio).
//
// PATCH /:year/warnings memorizza l'elenco delle warning confermate
// (`confirmedWarnings`) dentro la colonna JSON `overrides` di year_settings,
// così UI può sopprimere i warning già viste dall'utente.

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { YearSettingsInput } from '@shared/schemas';
import { isCoefficienteAmmesso } from '@shared/ateco-coefficienti';
import { isAnnoStartupValido, FORFETTARIO_RULES } from '@shared/forfettario-rules';
import { yearSettings, profiles } from '../db/schema';
import { HttpError } from '../middleware/error';
import { requireSession, type AuthEnv } from '../middleware/auth';
import type { Db } from '../db/client';

export const yearSettingsRoute = new Hono<AuthEnv>();

yearSettingsRoute.use('*', requireSession);

// ─────────────────────────── helpers ───────────────────────────

function parseYearParam(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno non valido: "${raw}"`);
  }
  return n;
}

function yearOf(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

/**
 * Restituisce l'anno di inizio attività del profilo (estratto da
 * `attivita.data_inizio_attivita`, JSON in colonna `profiles.attivita`).
 * Se mancante/malformato ritorna null: il chiamante decide se è bloccante
 * (per A1 lo è).
 */
async function getProfileStartYear(db: Db, profileId: string): Promise<number | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!row?.attivita) return null;
  try {
    const parsed = JSON.parse(row.attivita) as { data_inizio_attivita?: string };
    const iso = parsed.data_inizio_attivita;
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return yearOf(iso);
  } catch {
    return null;
  }
}

type YearSettingsRow = typeof yearSettings.$inferSelect;
type YearSettingsInsert = typeof yearSettings.$inferInsert;
type YearSettingsBody = z.infer<typeof YearSettingsInput>;

function toPublic(row: YearSettingsRow) {
  let overridesParsed: Record<string, unknown> | null = null;
  if (row.overrides) {
    try { overridesParsed = JSON.parse(row.overrides) as Record<string, unknown>; } catch { overridesParsed = null; }
  }
  return {
    profileId: row.profileId,
    year: row.year,
    regime: row.regime,
    coefficiente: row.coefficiente,
    impostaSostitutiva: row.impostaSostitutiva,
    inpsMode: row.inpsMode,
    inpsCategoria: row.inpsCategoria,
    riduzione35: row.riduzione35,
    riduzione35Comunicata: row.riduzione35Comunicata,
    riduzione35DataComunicazione: row.riduzione35DataComunicazione,
    haRedditoDipendente: row.haRedditoDipendente,
    limiteForfettario: row.limiteForfettario,
    scadenziarioMetodo: row.scadenziarioMetodo,
    prorogaSaldoAt: row.prorogaSaldoAt,
    primoAnnoFatturatoPrec: row.primoAnnoFatturatoPrec,
    primoAnnoImpostaPrec: row.primoAnnoImpostaPrec,
    primoAnnoAccontiImpostaPrec: row.primoAnnoAccontiImpostaPrec,
    primoAnnoContribVariabiliPrec: row.primoAnnoContribVariabiliPrec,
    primoAnnoAccontiContribPrec: row.primoAnnoAccontiContribPrec,
    tariffaGiornaliera: row.tariffaGiornaliera,
    overrides: overridesParsed,
  };
}

/**
 * Esegue i boundary checks fiscali sul payload (oltre alla validazione Zod
 * di forma). Lancia `HttpError(422, ...)` su violazione.
 */
async function assertValidYearSettings(db: Db, body: YearSettingsBody, year: number, profileId: string): Promise<void> {
  if (body.regime === 'ordinario') {
    throw new HttpError(
      422,
      'REGIME_NOT_SUPPORTED',
      'Il regime ordinario non è ancora supportato in questa versione di Lira.',
    );
  }

  if (!isCoefficienteAmmesso(body.coefficiente)) {
    throw new HttpError(
      422,
      'COEFFICIENTE_NON_AMMESSO',
      `Coefficiente ${body.coefficiente} non ammesso dal DM 23/01/2015 (validi: 0.40, 0.54, 0.62, 0.67, 0.78, 0.86).`,
    );
  }

  if (body.impostaSostitutiva === FORFETTARIO_RULES.sostitutivaStartup) {
    const annoInizio = await getProfileStartYear(db, profileId);
    if (annoInizio == null) {
      throw new HttpError(
        422,
        'INVALID_SOSTITUTIVA_5',
        'Impossibile applicare l\'aliquota 5% startup: data inizio attività non presente nel profilo.',
      );
    }
    if (!isAnnoStartupValido(annoInizio, year)) {
      throw new HttpError(
        422,
        'INVALID_SOSTITUTIVA_5',
        `Aliquota 5% startup non ammessa per ${year}: trascorsi ${year - annoInizio} anni `
          + `dall'inizio attività (${annoInizio}). L'agevolazione vale solo per i primi `
          + `${FORFETTARIO_RULES.startupMaxAnni} periodi d'imposta (art. 1 c. 65 L. 190/2014).`,
      );
    }
  }

  if (body.prorogaSaldoAt) {
    // La regex Zod garantisce già il pattern YYYY-07-DD, ma siamo difensivi
    // in caso lo schema cambi.
    if (!/^\d{4}-07-\d{2}$/.test(body.prorogaSaldoAt)) {
      throw new HttpError(
        422,
        'PROROGA_FUORI_LUGLIO',
        `La proroga del saldo deve cadere in luglio (ricevuto: ${body.prorogaSaldoAt}).`,
      );
    }
  }
}

// ─────────────────────────── GET /:year ───────────────────────────

yearSettingsRoute.get('/:year', async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');

  const [row] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND', `Impostazioni anno ${year} non trovate`);
  }
  return c.json({ yearSettings: toPublic(row) });
});

// ─────────────────────────── PUT /:year (upsert) ───────────────────────────

yearSettingsRoute.put('/:year', zValidator('json', YearSettingsInput), async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const body = c.req.valid('json');

  await assertValidYearSettings(db, body, year, profileId);

  const insertValues: YearSettingsInsert = {
    profileId,
    year,
    regime: body.regime,
    coefficiente: body.coefficiente,
    impostaSostitutiva: body.impostaSostitutiva,
    inpsMode: body.inpsMode,
    inpsCategoria: body.inpsCategoria,
    riduzione35: body.riduzione35,
    riduzione35Comunicata: body.riduzione35Comunicata,
    riduzione35DataComunicazione: body.riduzione35DataComunicazione ?? null,
    haRedditoDipendente: body.haRedditoDipendente,
    limiteForfettario: body.limiteForfettario,
    scadenziarioMetodo: body.scadenziarioMetodo,
    prorogaSaldoAt: body.prorogaSaldoAt ?? null,
    primoAnnoFatturatoPrec: body.primoAnnoFatturatoPrec ?? null,
    primoAnnoImpostaPrec: body.primoAnnoImpostaPrec ?? null,
    primoAnnoAccontiImpostaPrec: body.primoAnnoAccontiImpostaPrec ?? null,
    primoAnnoContribVariabiliPrec: body.primoAnnoContribVariabiliPrec ?? null,
    primoAnnoAccontiContribPrec: body.primoAnnoAccontiContribPrec ?? null,
    tariffaGiornaliera: body.tariffaGiornaliera ?? null,
    overrides: body.overrides ? JSON.stringify(body.overrides) : null,
  };

  // SQLite/libSQL non ha UPSERT nativo nel dialect Drizzle che usiamo:
  // strategia delete-then-insert in transazione.
  await db.transaction(async (tx) => {
    await tx
      .delete(yearSettings)
      .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));
    await tx.insert(yearSettings).values(insertValues);
  });

  const [row] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);
  return c.json({ yearSettings: toPublic(row!) });
});

// ─────────────────────────── PATCH /:year/warnings ───────────────────────────

const WarningsPatchInput = z.object({
  confirm: z.array(z.string()).optional(),
  unconfirm: z.array(z.string()).optional(),
});

yearSettingsRoute.patch('/:year/warnings', zValidator('json', WarningsPatchInput), async (c) => {
  const year = parseYearParam(c.req.param('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const { confirm = [], unconfirm = [] } = c.req.valid('json');

  const [row] = await db
    .select()
    .from(yearSettings)
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)))
    .limit(1);
  if (!row) {
    throw new HttpError(404, 'YEAR_SETTINGS_NOT_FOUND', `Impostazioni anno ${year} non trovate`);
  }

  // Parse difensivo dell'overrides JSON esistente; se corrotto, ricostruiamo
  // da capo (i confirmedWarnings sono soft state, non vale la pena 500-are).
  let overrides: Record<string, unknown> = {};
  if (row.overrides) {
    try {
      const parsed = JSON.parse(row.overrides) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        overrides = parsed as Record<string, unknown>;
      }
    } catch {
      overrides = {};
    }
  }

  const existing = Array.isArray(overrides.confirmedWarnings)
    ? (overrides.confirmedWarnings as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const next = new Set<string>(existing);
  for (const code of confirm) next.add(code);
  for (const code of unconfirm) next.delete(code);

  overrides.confirmedWarnings = Array.from(next);

  await db
    .update(yearSettings)
    .set({ overrides: JSON.stringify(overrides) })
    .where(and(eq(yearSettings.profileId, profileId), eq(yearSettings.year, year)));

  return c.json({ confirmedWarnings: overrides.confirmedWarnings });
});
