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
import { buildAccontoPlan, buildContributiAccontoPlan } from './tax-engine';
import { buildRolledDueDate } from '@shared/date-rules';

export type RigoSource = 'computed' | 'from-profile' | 'zero' | 'override';
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
export type F24Sezione = 'erario' | 'inps';
export interface F24Riga {
  sezione: F24Sezione;
  codice: string; // '1792' | '1790' | '1791' | 'AP' | 'CP' | 'P10'
  descrizione: string;
  annoRiferimento: number;
  importo: number; // sempre > 0 (le righe a 0 sono omesse)
}
export interface F24Modulo {
  scadenza: string;          // ISO, post proroga/rolling
  scadenzaOriginale: string; // ISO canonica (30/06 o 30/11 di N+1)
  prorogaApplied: boolean;
  righe: F24Riga[];
  totale: number;
}
export interface Dichiarazione {
  frontespizio: Frontespizio;
  quadroLM: Rigo[];
  quadroRR: QuadroRR;
  quadroRX: Rigo[];
  quadroRS: Rigo[];
  f24: F24Modulo[];
  warnings: DichiarazioneWarning[];
}

export interface DichiarazioneAnagrafica {
  cf?: string; nome?: string; cognome?: string; data_nascita?: string;
  residenza?: { citta?: string; provincia?: string };
}
export interface DichiarazioneYsView {
  regime: string;
  inpsMode: string;
  inpsCategoria: string | null;
  impostaSostitutiva: number;
  coefficiente: number;
  limiteForfettario: number;
  prorogaSaldoAt: string | null;
}
export interface DichiarazioneInput {
  year: number;
  scenario: ForfettarioScenario;
  ys: DichiarazioneYsView;
  anagrafica: DichiarazioneAnagrafica;
  dataInizioAttivita?: string;
  overrides: DichiarazioneOverridesInput;
}
export interface DichiarazioneOverridesInput {
  accontiVersati?: number | null;
  creditiImposta?: number | null;
  creditoAnnoPrec?: number | null;
}
export interface DichiarazioneOverridesApplied {
  imposta: number;
  accontiVersati: number;
  creditiImposta: number;
  creditoAnnoPrec: number;
  saldoEffettivo: number;
  creditoDaRiportare: number;
  overridden: { accontiVersati: boolean; creditiImposta: boolean; creditoAnnoPrec: boolean };
}

// r2: rete di sicurezza a 2 decimali (usata da quadro RR / righe INPS F24, che
// NON sono arrotondate all'euro). r0: arrotondamento all'unità di euro come da
// istruzioni AdE per i righi del modello (imposta sostitutiva, quadro LM/RX).
function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function r0(n: number): number {
  return Math.round(Number(n) || 0);
}
function rigo(key: string, label: string, value: number, source: RigoSource = 'computed'): Rigo {
  return { key, label, value: r2(value), source };
}
/** Rigo del modello, arrotondato all'unità di euro (LM/RX). */
function rigoEur(key: string, label: string, value: number, source: RigoSource = 'computed'): Rigo {
  return { key, label, value: r0(value), source };
}

/** Override ammesso solo se numero finito ≥ 0; altrimenti si usa il default calcolato. */
function pickOverride(v: number | null | undefined, fallback: number): { value: number; overridden: boolean } {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { value: r0(v), overridden: true };
  return { value: r0(fallback), overridden: false };
}

/**
 * Applica le rettifiche manuali (6C) a valle dello scenario. Default = valori
 * calcolati di 6A → invariante di non-regressione. Imposta NON è override-abile.
 * Tutte le grandezze sono arrotondate all'unità di euro (modello Redditi PF, #3).
 */
export function applyDichiarazioneOverrides(
  s: ForfettarioScenario, ov: DichiarazioneOverridesInput,
): DichiarazioneOverridesApplied {
  const imposta = r0(s.substituteTax);
  // Fix A6: LM45 = acconti REALMENTE versati (non cappati all'imposta). Con il
  // vecchio `substituteTax − taxSaldo` un sovra-acconto (acconti > imposta)
  // veniva troncato all'imposta e il credito LM47/RX31 col.5 spariva. Usiamo il
  // dato reale dallo scenario (coerente col taxSaldo), con fallback prudente.
  const accReali = s.accontiSostitutivaPagatiReali != null
    ? Math.max(0, r0(s.accontiSostitutivaPagatiReali))
    : Math.max(0, r0(s.substituteTax - s.taxSaldo));
  const acc = pickOverride(ov.accontiVersati, accReali);
  const cred = pickOverride(ov.creditiImposta, 0);
  const credPrev = pickOverride(ov.creditoAnnoPrec, 0);
  // Fix M4: i crediti d'imposta (LM40) si scomputano fino a CONCORRENZA
  // dell'imposta (LM39); l'eccedenza NON genera credito RX31 col.5 (va nel
  // quadro RN). Solo acconti (LM45) ed eccedenza dich. precedente (LM43)
  // possono generare il credito da riportare.
  const creditiUsati = Math.min(cred.value, imposta);
  const differenza = Math.max(0, imposta - creditiUsati); // LM42 (differenza)
  const netDebito = differenza - credPrev.value - acc.value;
  return {
    imposta,
    accontiVersati: acc.value,
    creditiImposta: cred.value,
    creditoAnnoPrec: credPrev.value,
    saldoEffettivo: Math.max(0, netDebito),
    creditoDaRiportare: Math.max(0, -netDebito),
    overridden: { accontiVersati: acc.overridden, creditiImposta: cred.overridden, creditoAnnoPrec: credPrev.overridden },
  };
}

/**
 * Quadro LM Sez. III (forfettario), numerazione fedele al modello Redditi PF:
 * LM22 componenti positivi, LM34 reddito lordo, LM35 contributi, LM36 reddito
 * netto, LM38 imponibile, LM39 imposta, LM40 crediti, LM41 ritenute (=0 art.1
 * c.67), LM43 eccedenza dich. precedente, LM45 acconti, LM46 debito, LM47 credito.
 */
export function buildQuadroLM(s: ForfettarioScenario, a: DichiarazioneOverridesApplied): Rigo[] {
  const redditoNetto = Math.max(0, s.forfettarioGrossIncome - s.deductibleContributionsPaid);
  return [
    rigoEur('LM22', 'Componenti positivi (ricavi/compensi percepiti)', s.grossCollected),
    rigoEur('LM34', 'Reddito lordo (ricavi × coefficiente)', s.forfettarioGrossIncome),
    rigoEur('LM35', 'Contributi previdenziali e assistenziali deducibili', s.deductibleContributionsPaid),
    rigoEur('LM36', 'Reddito netto', redditoNetto),
    rigoEur('LM38', 'Reddito al netto delle perdite (imponibile)', s.taxableBase),
    rigoEur('LM39', 'Imposta sostitutiva', a.imposta),
    rigoEur('LM40', 'Crediti d\'imposta', a.creditiImposta, a.overridden.creditiImposta ? 'override' : 'zero'),
    rigoEur('LM41', 'Ritenute (regime forfettario: art. 1 c. 67 L. 190/2014)', 0, 'zero'),
    rigoEur('LM43', 'Eccedenza d\'imposta dalla dichiarazione precedente', a.creditoAnnoPrec, a.overridden.creditoAnnoPrec ? 'override' : 'zero'),
    rigoEur('LM45', 'Acconti versati', a.accontiVersati, a.overridden.accontiVersati ? 'override' : 'computed'),
    rigoEur('LM46', 'Imposta sostitutiva a debito (saldo)', a.saldoEffettivo),
    rigoEur('LM47', 'Imposta sostitutiva a credito', a.creditoDaRiportare, a.creditoDaRiportare > 0 ? 'computed' : 'zero'),
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

/**
 * Quadro RX, rigo RX31 (imposta sostitutiva regime forfettario, riferito a LM):
 * col.1 = imposta a debito (= LM46), col.5 = credito da riportare/compensare
 * (= LM47). Il credito ANNO PRECEDENTE non sta qui: è in LM43 (eccedenza dich.
 * precedente). Valori in euro interi.
 */
export function buildQuadroRX(a: DichiarazioneOverridesApplied): Rigo[] {
  return [
    rigoEur('RX31', 'RX31 col.1 — Imposta sostitutiva a debito', a.saldoEffettivo, a.saldoEffettivo > 0 ? 'computed' : 'zero'),
    rigoEur('RX31cred', 'RX31 col.5 — Credito da riportare/compensare', a.creditoDaRiportare, a.creditoDaRiportare > 0 ? 'computed' : 'zero'),
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
  // Soglia forfettario: misurata sui RICAVI/compensi percepiti (art. 1 c. 54
  // L. 197/2022), NON sul reddito coefficiente-ridotto. Coerente con regime.ts.
  const ricavi = inp.scenario.grossCollected;
  const limite = inp.ys.limiteForfettario || 85000;
  const limite100 = limite + 15000;
  if (ricavi > limite100) {
    w.push({ code: 'SOGLIA_100K', severity: 'warn', message: `Ricavi oltre ${limite100} €: decadenza immediata dal forfettario nell'anno corrente (L. 197/2022).` });
  } else if (ricavi > limite) {
    w.push({ code: 'SOGLIA_85K', severity: 'warn', message: `Ricavi oltre ${limite} €: decadenza dal forfettario dall'anno successivo.` });
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

/** Causale contributo INPS per la sezione INPS dell'F24 (contributi variabili). */
export function inpsCausale(inpsMode: string, inpsCategoria: string | null): string {
  if (inpsMode === 'gestione_separata') return 'P10';
  return inpsCategoria === 'commerciante' ? 'CP' : 'AP';
}

const F24_ERARIO = { saldo: '1792', acc1: '1790', acc2: '1791' } as const;

function f24Riga(sezione: F24Sezione, codice: string, descrizione: string, annoRiferimento: number, importo: number): F24Riga {
  return { sezione, codice, descrizione, annoRiferimento, importo: r2(importo) };
}

interface ResolvedDue { scadenza: string; prorogaApplied: boolean; }
function resolveGiugno(year: number, prorogaSaldoAt: string | null): ResolvedDue {
  if (prorogaSaldoAt) return { scadenza: prorogaSaldoAt, prorogaApplied: true };
  return { scadenza: buildRolledDueDate(`${year + 1}-06-30`).date, prorogaApplied: false };
}

/**
 * Moduli F24 da dichiarazione (anno d'imposta N → versamenti N+1):
 * 30/06/N+1 = saldo sostitutiva (anno N) + acconto 1 (anno N+1) + saldo/acconto1 INPS;
 * 30/11/N+1 = acconto 2 (anno N+1) + acconto 2 INPS.
 * Acconti N+1 RICALCOLATI sulla base imposta(N)/contributi(N). Righe a 0 omesse;
 * moduli senza righe non emessi.
 */
export function buildF24(s: ForfettarioScenario, ys: DichiarazioneYsView, year: number, a: DichiarazioneOverridesApplied): F24Modulo[] {
  if (ys.regime !== 'forfettario') return [];

  // Gli acconti su N+1 si basano volutamente sull'imposta grezza dello scenario (s.substituteTax),
  // NON su a.saldoEffettivo: gli override 6C toccano solo il saldo dell'anno corrente (tributo 1792),
  // mai la base di ricalcolo degli acconti.
  const taxAcc = buildAccontoPlan(s.substituteTax);
  const gestione = ys.inpsMode === 'gestione_separata' ? 'gestione_separata' : 'artigiani_commercianti';
  const inpsAcc = buildContributiAccontoPlan(s.contributiVariabiliDovuti, gestione);
  const causale = inpsCausale(ys.inpsMode, ys.inpsCategoria);

  const giugnoBase = `${year + 1}-06-30`;
  const novembreBase = `${year + 1}-11-30`;
  const giugno = resolveGiugno(year, ys.prorogaSaldoAt);
  const novembre = buildRolledDueDate(novembreBase);

  const righeGiugno = [
    f24Riga('erario', F24_ERARIO.saldo, 'Imposta sostitutiva — saldo', year, a.saldoEffettivo),
    f24Riga('erario', F24_ERARIO.acc1, 'Imposta sostitutiva — acconto 1ª rata', year + 1, taxAcc.first),
    f24Riga('inps', causale, 'Contributi INPS variabili — saldo', year, s.contributionSaldo),
    f24Riga('inps', causale, 'Contributi INPS variabili — acconto 1ª rata', year + 1, inpsAcc.first),
  ].filter((r) => r.importo > 0);

  const righeNovembre = [
    f24Riga('erario', F24_ERARIO.acc2, 'Imposta sostitutiva — acconto 2ª rata', year + 1, taxAcc.second),
    f24Riga('inps', causale, 'Contributi INPS variabili — acconto 2ª rata', year + 1, inpsAcc.second),
  ].filter((r) => r.importo > 0);

  const moduli: F24Modulo[] = [];
  if (righeGiugno.length) {
    moduli.push({
      scadenza: giugno.scadenza, scadenzaOriginale: giugnoBase, prorogaApplied: giugno.prorogaApplied,
      righe: righeGiugno, totale: r2(righeGiugno.reduce((a, r) => a + r.importo, 0)),
    });
  }
  if (righeNovembre.length) {
    moduli.push({
      scadenza: novembre.date, scadenzaOriginale: novembreBase, prorogaApplied: false,
      righe: righeNovembre, totale: r2(righeNovembre.reduce((a, r) => a + r.importo, 0)),
    });
  }
  return moduli;
}

/** Warning specifici dell'F24 (info, non bloccanti). */
export function buildF24Warnings(
  f24: F24Modulo[], s: ForfettarioScenario, ys: DichiarazioneYsView,
): DichiarazioneWarning[] {
  const w: DichiarazioneWarning[] = [];
  if (ys.regime !== 'forfettario') return w;
  const taxAcc = buildAccontoPlan(s.substituteTax);
  if (s.substituteTax > 0 && taxAcc.total === 0) {
    w.push({ code: 'F24_ACCONTI_SOTTO_SOGLIA', severity: 'info', message: 'Imposta sostitutiva sotto la soglia di 51,65 €: nessun acconto dovuto per l\'anno successivo.' });
  }
  if (f24.length > 0) {
    w.push({ code: 'F24_INPS_SEDE_MANCANTE', severity: 'info', message: 'Prospetto di calcolo: sede e matricola INPS non sono incluse, quindi l\'F24 non è pronto per la trasmissione.' });
  }
  return w;
}

/** Assembla la dichiarazione completa dai dati dell'anno. */
export function buildDichiarazione(inp: DichiarazioneInput): Dichiarazione {
  const applied = applyDichiarazioneOverrides(inp.scenario, inp.overrides);
  const f24 = buildF24(inp.scenario, inp.ys, inp.year, applied);
  const warnings: DichiarazioneWarning[] = [...buildWarnings(inp), ...buildF24Warnings(f24, inp.scenario, inp.ys)];
  const anyOverride = applied.overridden.accontiVersati || applied.overridden.creditiImposta || applied.overridden.creditoAnnoPrec;
  if (anyOverride) {
    warnings.push({ code: 'DICH_OVERRIDE_ATTIVO', severity: 'info', message: 'Rettifiche manuali attive: alcuni importi sono stati impostati manualmente e differiscono dal calcolo automatico.' });
  }
  // #4: gli acconti versati (LM45) di default sono STIMATI dai pagamenti tracciati,
  // non dagli F24 effettivamente versati: invita a verificare per evitare di gonfiare
  // (o sgonfiare) il saldo. Sopito dall'override manuale dell'acconto.
  if (applied.accontiVersati > 0 && !applied.overridden.accontiVersati) {
    warnings.push({ code: 'DICH_ACCONTI_STIMATI', severity: 'info', message: 'Acconti versati (LM45) stimati dai pagamenti registrati: verifica con gli F24 effettivamente versati e rettifica se necessario.' });
  }
  return {
    frontespizio: buildFrontespizio(inp),
    quadroLM: buildQuadroLM(inp.scenario, applied),
    quadroRR: buildQuadroRR(inp.scenario, inp.ys.inpsMode),
    quadroRX: buildQuadroRX(applied),
    quadroRS: buildQuadroRS(),
    f24,
    warnings,
  };
}
