// src/shared/nc-sync.ts
//
// Sincronizzazione storno Nota di Credito (TD04) -> fattura originale.
// Port puro di CalcoliVari/fatture-nc-sync.js: nessuna mutazione, ritorna i
// nuovi valori da persistere. Idempotente via ncIds, tolleranza 0,01.

const TOLLERANZA_TOTALE = 0.01; // €: sotto questa soglia uno storno parziale vale come totale

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface StornoInput {
  originaleImporto: number;
  originaleStato: string;
  originaleNcIds: string[];
  originaleNcTotaleImporto: number;
  ncId: string;
  ncImporto: number;
}

export interface StornoResult {
  applied: boolean;
  tipoStorno: 'parziale' | 'totale';
  ncIds: string[];
  ncTotaleImporto: number;
  stato: string;
}

/** Calcola gli effetti di una NC TD04 inviata sull'originale. Puro/idempotente. */
export function computeStorno(input: StornoInput): StornoResult {
  const prevIds = Array.isArray(input.originaleNcIds) ? input.originaleNcIds : [];
  const already = prevIds.indexOf(input.ncId) >= 0;
  const ncImp = Math.abs(Number(input.ncImporto) || 0);

  const ncIds = already ? prevIds.slice() : [...prevIds, input.ncId];
  const ncTotaleImporto = already
    ? round2(Number(input.originaleNcTotaleImporto) || 0)
    : round2((Number(input.originaleNcTotaleImporto) || 0) + ncImp);

  const origImp = Number(input.originaleImporto) || 0;
  let tipoStorno: 'parziale' | 'totale';
  if (origImp <= 0) {
    tipoStorno = 'parziale';
  } else {
    tipoStorno = (ncTotaleImporto + TOLLERANZA_TOTALE >= origImp) ? 'totale' : 'parziale';
  }

  const stato = (tipoStorno === 'totale' && input.originaleStato !== 'stornata')
    ? 'stornata'
    : input.originaleStato;

  return { applied: !already, tipoStorno, ncIds, ncTotaleImporto, stato };
}

/**
 * true se aggiungere `ncImporto` agli storni già accumulati supererebbe
 * l'importo della fattura originale (tolleranza 0,01 €). Una NC non può
 * stornare più di quanto fatturato (art. 26 DPR 633/72). Usata sia alla
 * CREAZIONE della NC sia DENTRO la transazione di /invia (due NC parziali
 * concorrenti non devono cumulare oltre il totale).
 */
export function isOverStorno(originaleImporto: number, ncTotaleEsistente: number, ncImporto: number): boolean {
  const cum = round2((Number(ncTotaleEsistente) || 0) + Math.abs(Number(ncImporto) || 0));
  return cum > round2(Number(originaleImporto) || 0) + TOLLERANZA_TOTALE;
}

/** data NC >= data originale (ISO YYYY-MM-DD). true se una delle due manca. */
export function isNCDateValid(dataNC: string | null | undefined, dataOriginale: string | null | undefined): boolean {
  if (!dataNC || !dataOriginale) return true;
  return String(dataNC) >= String(dataOriginale);
}
