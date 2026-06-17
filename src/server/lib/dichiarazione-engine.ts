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

// r2: rete di sicurezza a 2 decimali. NON usa ceil2 come il tax-engine perché
// questo layer NON arrotonda fiscalmente — i valori autoritativi arrivano già
// ceil2 dallo scenario; qui si mappa soltanto.
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

/** Quadro RR (INPS): ramo gestione separata (sez. II) o artigiani/commercianti (sez. I). */
export function buildQuadroRR(s: ForfettarioScenario, inpsMode: string): QuadroRR {
  if (inpsMode === 'gestione_separata') {
    return {
      sezione: 'gestione_separata',
      righi: [
        rigo('RR_GS_BASE', 'Reddito imponibile previdenziale', s.forfettarioGrossIncome),
        rigo('RR_GS_DOVUTI', 'Contributi dovuti (gestione separata)', s.contributiVariabiliDovuti),
      ],
    };
  }
  const fissi = s.previousFixedTail + s.currentFixedWithinYear;
  const variabili = s.contributiVariabiliDovuti;
  return {
    sezione: 'artigiani_commercianti',
    righi: [
      rigo('RR_FISSI', 'Contributi sul minimale (quote fisse dell\'anno)', fissi),
      rigo('RR_VARIABILI', 'Contributi eccedenti il minimale', variabili),
      rigo('RR_TOTALE', 'Totale contributi dovuti', fissi + variabili),
    ],
  };
}

/** Quadro RX (compensazioni): in 6A nessun credito da anno precedente (→ 6C). */
export function buildQuadroRX(): Rigo[] {
  return [
    rigo('RX1', 'Credito da anno precedente', 0, 'zero'),
    rigo('RX4', 'Credito da riportare al periodo successivo', 0, 'zero'),
  ];
}

/** Quadro RS (dati informativi forfettari): vuoto in 6A (override informativi → 6C). */
export function buildQuadroRS(): Rigo[] {
  return [];
}

function yearOf(iso: string | undefined): number | null {
  if (!iso || !/^\d{4}/.test(iso)) return null;
  return Number(iso.slice(0, 4));
}

/** Frontespizio: contribuente dal profilo (anagrafica). Campi mancanti → '' (warning). */
export function buildFrontespizio(inp: DichiarazioneInput): Frontespizio {
  const a = inp.anagrafica;
  return {
    codiceFiscale: (a.cf ?? '').toUpperCase(),
    cognome: a.cognome ?? '',
    nome: a.nome ?? '',
    dataNascita: a.data_nascita ?? '',
    comune: a.residenza?.citta ?? '',
    provincia: (a.residenza?.provincia ?? '').toUpperCase(),
    annoImposta: inp.year,
    regime: 'RF19',
    tipoDichiarazione: 'ordinaria',
  };
}

/** Validazione fiscale → warning (error bloccanti per la compilazione, warn/info no). */
export function buildWarnings(inp: DichiarazioneInput): DichiarazioneWarning[] {
  const w: DichiarazioneWarning[] = [];
  const a = inp.anagrafica;

  if (inp.ys.regime !== 'forfettario') {
    w.push({ code: 'REGIME_NON_FORFETTARIO', severity: 'error', message: 'Il regime dell\'anno non è forfettario: questa dichiarazione copre solo RF19.' });
  }
  if (!a.cf || !(a.nome && a.cognome) || !a.data_nascita) {
    w.push({ code: 'FRONTESPIZIO_INCOMPLETO', severity: 'error', message: 'Anagrafica incompleta (codice fiscale, nome/cognome, data di nascita): completala nel Profilo personale.' });
  }
  const redditoLordo = inp.scenario.forfettarioGrossIncome;
  const limite = inp.ys.limiteForfettario || 85000;
  if (redditoLordo > limite + 15000) {
    w.push({ code: 'SOGLIA_100K', severity: 'warn', message: `Reddito lordo oltre ${limite + 15000} €: decadenza immediata dal forfettario nell'anno corrente (L. 197/2022).` });
  } else if (redditoLordo > limite) {
    w.push({ code: 'SOGLIA_85K', severity: 'warn', message: `Reddito lordo oltre ${limite} €: decadenza dal forfettario dall'anno successivo.` });
  }
  if (inp.ys.impostaSostitutiva === 0.05) {
    const annoInizio = yearOf(inp.dataInizioAttivita);
    if (annoInizio !== null && inp.year - annoInizio > 4) {
      w.push({ code: 'STARTUP_5PCT_SCADUTO', severity: 'warn', message: 'Aliquota startup 5% applicata ma sono trascorsi più di 5 anni dall\'apertura della P.IVA (art. 1 c. 65 L. 190/2014): verifica.' });
    }
  }
  w.push({ code: 'RS_INFORMATIVO', severity: 'info', message: 'Quadro RS: i dati sono solo informativi e NON deducono dal reddito forfettario.' });
  return w;
}

/** Assembla la dichiarazione completa dai dati dell'anno. */
export function buildDichiarazione(inp: DichiarazioneInput): Dichiarazione {
  return {
    frontespizio: buildFrontespizio(inp),
    quadroLM: buildQuadroLM(inp.scenario),
    quadroRR: buildQuadroRR(inp.scenario, inp.ys.inpsMode),
    quadroRX: buildQuadroRX(),
    quadroRS: buildQuadroRS(),
    warnings: buildWarnings(inp),
  };
}
