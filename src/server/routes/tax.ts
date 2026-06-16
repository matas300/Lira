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
import { buildForfettarioScenario, buildForfettarioMethodComparison } from '../lib/tax-engine';
import { loadScenarioData } from '../lib/scenario-data';
import { HttpError } from '../middleware/error';
import { requireSession, type AuthEnv } from '../middleware/auth';

export const taxRoute = new Hono<AuthEnv>();

taxRoute.use('*', requireSession);

/**
 * Risolve il parametro `year` di una query: assente → anno corrente UTC;
 * presente ma non intero 2000-2100 → 400 INVALID_YEAR. Stessa convenzione di
 * `/rules` (estratta per riuso fra `/rules` e `/scenario`).
 */
function resolveYearQuery(yearQ: string | undefined): number {
  if (yearQ === undefined) return new Date().getUTCFullYear();
  const parsed = Number(yearQ);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new HttpError(400, 'INVALID_YEAR', `Anno "${yearQ}" non valido: atteso un intero tra 2000 e 2100.`);
  }
  return parsed;
}

// ─────────────────────────── GET /rules?year=YYYY ───────────────────────────

taxRoute.get('/rules', (c) => {
  // year opzionale: se assente → anno corrente. Se presente deve essere un
  // intero 2000-2100 (un anno mancante in tabella resta lecito → null nel body,
  // by design; un anno NON parseabile è invece un input errato → 400).
  const year = resolveYearQuery(c.req.query('year'));
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

// ─────────────────────────── GET /scenario?year=YYYY ───────────────────────────
//
// Posizione fiscale REALE dell'anno selezionato per il profilo della sessione:
// legge fatture incassate, pagamenti acconto e year-settings (via
// `loadScenarioData`), poi chiama il motore (`buildForfettarioMethodComparison`).
// Stateless dal punto di vista fiscale: tutta la matematica è nel motore, qui
// solo orchestrazione I/O + breakdown mensile proporzionale.
//
// Contratto (sorgente di verità BE↔FE, vedi plan):
//  - year-settings assenti → { year, needsConfig: true }
//  - altrimenti → { year, needsConfig: false, grossCollected, limite,
//                   comparison: ComparisonOutput, monthly: [...] }
//  monthly[i] = { month, lordo (incassato del mese), netto, tasseContrib, fonte }
//  con netto/tasseContrib ripartiti proporzionalmente al lordo mensile rispetto
//  al totale annuo dello scenario selezionato.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

taxRoute.get('/scenario', async (c) => {
  const year = resolveYearQuery(c.req.query('year'));
  const db = c.get('db');
  const profileId = c.get('activeProfileId');

  const data = await loadScenarioData(db, profileId, year);
  if (!data) {
    return c.json({ year, needsConfig: true });
  }

  const comparison = buildForfettarioMethodComparison(data.comparisonInput);
  const selected = comparison.selected;

  // Ripartizione mensile: il netto/tasse annui dello scenario selezionato sono
  // distribuiti pro-quota sul lordo incassato di ciascun mese. La somma dei
  // mesi può divergere di centesimi dal totale annuo (arrotondamenti per riga):
  // è un breakdown UI, non un dato fiscale (la verità resta in `comparison`).
  const gross = data.grossCollected;
  const tasseContribAnnuo = round2(selected.substituteTax + selected.deductibleContributionsPaid);
  const nettoAnnuo = round2(gross - tasseContribAnnuo);

  const monthly = data.monthly.map((m) => {
    const ratio = gross > 0 ? m.lordo / gross : 0;
    const tasseContrib = round2(tasseContribAnnuo * ratio);
    const netto = round2(m.lordo - tasseContrib);
    return { month: m.month, lordo: round2(m.lordo), netto, tasseContrib, fonte: 'Fattura' };
  });

  return c.json({
    year,
    needsConfig: false,
    grossCollected: gross,
    limite: FORFETTARIO_RULES.sogliaIngresso,
    comparison,
    monthly,
    // Echo del netto annuo (derivabile dal FE, ma comodo per evitare drift di
    // arrotondamento fra somma mensile e sintesi).
    nettoAnnuo,
  });
});
