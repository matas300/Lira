// src/server/routes/tax.ts
//
// Endpoint REST per il motore fiscale:
//  - GET  /api/tax/rules?year=YYYY   catalogo costanti (INPS, acconto, forfettario)
//  - POST /api/tax/simulate          what-if su `buildForfettarioScenario`
//
// Convenzioni:
//  - Entrambi gli endpoint richiedono sessione attiva (`requireSession`).
//  - GET /rules è "thin": espone i record `INPS_ARTCOM[year]` / `INPS_GS[year]`
//    senza throw quando l'anno manca (ritorna `null`); il client deve poter
//    consultare il catalogo anche per anni futuri non ancora coperti.
//  - POST /simulate, al contrario, ha bisogno dei parametri INPS per costruire
//    lo scenario: se mancano → 422 INPS_PARAMS_UNAVAILABLE. La 422 è preferita
//    alla 400 perché l'input è sintatticamente valido ma semanticamente non
//    processabile (anno non ancora pubblicato).
//  - Lo scenario è costruito con `buildForfettarioScenario` (tax-engine.ts), che
//    è puro: nessuna persistenza, nessuna lettura DB. La simulazione è quindi
//    fully stateless: gli unici input sono `body` + costanti `@shared/*`.
//  - Default fiscali (coefficiente 0.67, aliquota 0.15) ricavati da
//    `FORFETTARIO_RULES.sostitutivaStandard`. La categoria INPS default è
//    'artigiano' (Mattia/Peru lavorano con codici ATECO artigianali).
//  - I valori "previousContribution" / "previousTaxBase" / "accontiReali" sono
//    azzerati: l'endpoint serve simulazioni what-if quick, non bilanci storici.
//    Per i bilanci esistono lo scadenziario (`/api/scadenziario/:year`) e il
//    `scadenziario-service` che leggono i pagamenti reali.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { TaxSimulateInput } from '@shared/schemas';
import { INPS_ARTCOM, INPS_GS, getInpsArtComForYear } from '@shared/inps-params';
import { ACCONTO_RULES } from '@shared/acconto-rules';
import { FORFETTARIO_RULES } from '@shared/forfettario-rules';
import { buildForfettarioScenario } from '../lib/tax-engine';
import { HttpError } from '../middleware/error';
import { requireSession, type AuthEnv } from '../middleware/auth';

export const taxRoute = new Hono<AuthEnv>();

taxRoute.use('*', requireSession);

// ─────────────────────────── GET /rules?year=YYYY ───────────────────────────

taxRoute.get('/rules', (c) => {
  const yearQ = c.req.query('year');
  // year opzionale: se assente → anno corrente. Se presente deve essere un
  // intero 2000-2100 (un anno mancante in tabella resta lecito → null nel body,
  // by design; un anno NON parseabile è invece un input errato → 400).
  let year = new Date().getUTCFullYear();
  if (yearQ !== undefined) {
    const parsed = Number(yearQ);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      throw new HttpError(400, 'INVALID_YEAR', `Anno "${yearQ}" non valido: atteso un intero tra 2000 e 2100.`);
    }
    year = parsed;
  }
  return c.json({
    year,
    inpsArtcom: INPS_ARTCOM[year] ?? null,
    inpsGs: INPS_GS[year] ?? null,
    accontoRules: ACCONTO_RULES,
    forfettarioRules: FORFETTARIO_RULES,
  });
});

// ─────────────────────────── POST /simulate ───────────────────────────

taxRoute.post('/simulate', zValidator('json', TaxSimulateInput), (c) => {
  const body = c.req.valid('json');
  const year = body.year;

  let inps;
  try {
    inps = getInpsArtComForYear(year);
  } catch {
    throw new HttpError(
      422,
      'INPS_PARAMS_UNAVAILABLE',
      `INPS params per ${year} non disponibili`,
    );
  }

  const coefficiente = body.settings?.coefficiente ?? 0.67;
  const sostitutiva = body.settings?.impostaSostitutiva ?? FORFETTARIO_RULES.sostitutivaStandard;
  const riduzioneApplica = body.settings?.riduzione35 === 1;
  const riduzioneFactor = riduzioneApplica ? FORFETTARIO_RULES.riduzioneInpsCoefficiente : 1;
  const categoria = body.settings?.inpsCategoria ?? 'artigiano';
  const fixedAnnual =
    (categoria === 'commerciante'
      ? inps.quotaFissaAnnuaCommerciante
      : inps.quotaFissaAnnuaArtigiano) * riduzioneFactor;

  const scenario = buildForfettarioScenario({
    year,
    method: body.method ?? 'storico',
    settings: {
      coefficiente,
      impostaSostitutiva: sostitutiva,
      riduzione35: riduzioneApplica,
    },
    grossCollected: body.grossCollected,
    currentContribution: { mode: 'artigiani_commercianti', fixedAnnual, saldoAccontoBase: 0 },
    previousContribution: { mode: 'artigiani_commercianti', fixedAnnual, saldoAccontoBase: 0 },
    previousTaxBase: 0,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
  });
  return c.json(scenario);
});
