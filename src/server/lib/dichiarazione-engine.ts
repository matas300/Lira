// src/server/lib/dichiarazione-engine.ts
//
// Motore PURO della dichiarazione PF forfettaria (Redditi PF): mappa uno
// `ForfettarioScenario` GIÀ calcolato (tax-engine) nei righi dei quadri ufficiali
// LM/RR/RX/RS + frontespizio + warning. NON ricalcola la fiscalità (single source
// of truth = tax-engine): qui si mappa. Read-only (slice 6A); override e perdite
// pregresse arriveranno in 6C, F24 in 6B.
//
// Audit fiscale (vs CalcoliVari dichiarazione-engine.js): LM cassa art.1 c.64
// L.190/2014, RS informativo non deducibile, RX clamp credito, soglie 85k/100k,
// startup 5% art.1 c.65, ritenute forfettario = 0 (art.1 c.67). Aliquote INPS e
// acconti sono già year-aware nello scenario.

import type { ForfettarioScenario } from './tax-engine';

export type RigoSource = 'computed' | 'from-profile' | 'zero';
export interface Rigo {
  key: string;
  label: string;
  value: number;
  source: RigoSource;
}
export interface DichiarazioneWarning {
  code: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
}
export interface Frontespizio {
  codiceFiscale: string;
  cognome: string;
  nome: string;
  dataNascita: string;
  comune: string;
  provincia: string;
  annoImposta: number;
  regime: string; // 'RF19' forfettario
  tipoDichiarazione: string; // 'ordinaria'
}
export interface QuadroRR {
  sezione: 'gestione_separata' | 'artigiani_commercianti';
  righi: Rigo[];
}
export interface Dichiarazione {
  frontespizio: Frontespizio;
  quadroLM: Rigo[];
  quadroRR: QuadroRR;
  quadroRX: Rigo[];
  quadroRS: Rigo[];
  warnings: DichiarazioneWarning[];
}

export interface DichiarazioneAnagrafica {
  cf?: string; nome?: string; cognome?: string; data_nascita?: string;
  residenza?: { citta?: string; provincia?: string };
}
export interface DichiarazioneYsView {
  regime: string;
  inpsMode: string;
  impostaSostitutiva: number;
  coefficiente: number;
  limiteForfettario: number;
}
export interface DichiarazioneInput {
  year: number;
  scenario: ForfettarioScenario;
  ys: DichiarazioneYsView;
  anagrafica: DichiarazioneAnagrafica;
  dataInizioAttivita?: string;
}

function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function rigo(key: string, label: string, value: number, source: RigoSource = 'computed'): Rigo {
  return { key, label, value: r2(value), source };
}

/** Quadro LM (forfettario): mappa reddito e imposta sostitutiva dallo scenario. */
export function buildQuadroLM(s: ForfettarioScenario): Rigo[] {
  const lm4 = Math.max(0, s.forfettarioGrossIncome - s.deductibleContributionsPaid);
  const accontiImputati = Math.max(0, s.substituteTax - s.taxSaldo);
  return [
    rigo('LM1', 'Ricavi/compensi percepiti', s.grossCollected),
    rigo('LM2', 'Reddito forfettario lordo (ricavi × coefficiente)', s.forfettarioGrossIncome),
    rigo('LM3', 'Contributi previdenziali deducibili (cassa)', s.deductibleContributionsPaid),
    rigo('LM4', 'Reddito al netto dei contributi', lm4),
    rigo('LM34', 'Reddito imponibile', s.taxableBase),
    rigo('LM36', 'Imposta sostitutiva', s.substituteTax),
    rigo('LM43', 'Acconti versati', accontiImputati),
    rigo('LM45', 'Imposta sostitutiva a debito (saldo)', s.taxSaldo),
  ];
}
