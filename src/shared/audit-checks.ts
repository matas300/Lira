// Runtime warnings per i finding dell'audit 25/05/2026 (porting da CalcoliVari
// + estensione). Modulo puro, no DB: riceve uno snapshot del contesto e
// restituisce gli `AuditWarning` applicabili. Consumato da scadenziario-service
// (Task 15) e dai boundary REST.
//
// Finding coperti:
// - C1 — soglia ricavi 85k/100k (L. 197/2022 art. 1 c. 54/71). Allerta utente
//   quando si avvicina/supera le soglie del forfettario.
// - A1 — sostitutiva ridotta 5% startup (art. 1 c. 65 L. 190/2014). Info
//   quando l'utente è entro i 5 anni; block quando l'anno selezionato
//   superato il quinto periodo d'imposta dall'inizio attività.
// - M1 — riduzione 35% INPS artigiani/commercianti (art. 1 c. 77 L. 190/2014).
//   La riduzione opera solo se comunicata a INPS entro 28/02; warning quando
//   l'utente ha attivato il flag ma non ha confermato la comunicazione.
//
// Extra info (non in audit, ma utile UX): `NO_REVENUE_SOURCE` quando l'anno
// non ha ancora alcun fatturato registrato → comparirà nel dashboard come
// suggerimento di importare/inserire i primi ricavi.

import { FORFETTARIO_RULES, isAnnoStartupValido } from './forfettario-rules';

export type WarningSeverity = 'info' | 'warning' | 'block';

export interface AuditWarning {
  code: string;
  severity: WarningSeverity;
  title: string;
  message: string;
  suggestedAction?: string;
  context?: Record<string, unknown>;
}

export interface AuditContext {
  year: number;
  yearSettings: {
    regime: string;
    coefficiente: number;
    impostaSostitutiva: number;
    inpsMode: string;
    inpsCategoria: string | null;
    riduzione_35: number;
    riduzione_35_comunicata: number;
    scadenziarioMetodo: string;
  };
  profile: { dataInizioAttivita: string };
  grossCollected: number;
  today: string;
}

/**
 * Estrae l'anno (YYYY) da una data ISO `YYYY-MM-DD`. Assume formato valido:
 * la validazione di `dataInizioAttivita` avviene a monte (Zod su profile).
 */
function yearOf(iso: string): number {
  return parseInt(iso.slice(0, 4), 10);
}

/**
 * C1 — Soglia ricavi forfettario.
 * - `> 100.000`: cessazione immediata del regime (L. 197/2022 art. 1 c. 71)
 *   con applicazione IVA dalla fattura che ha determinato il superamento.
 * - `> 85.000 e ≤ 100.000`: si esce dal regime dall'anno successivo
 *   (L. 197/2022 art. 1 c. 54).
 * - `≤ 85.000`: nessuna allerta. Uguaglianza a 85k ammessa (la soglia è
 *   "fino a 85k" inclusivo).
 */
export function checkC1_soglia(ctx: AuditContext): AuditWarning | null {
  const { grossCollected } = ctx;
  const { sogliaIngresso, sogliaCessazioneImmediata } = FORFETTARIO_RULES;

  if (grossCollected > sogliaCessazioneImmediata) {
    return {
      code: 'C1_CESSAZIONE_IMMEDIATA',
      severity: 'warning',
      title: 'Soglia 100.000 € superata',
      message: `Hai incassato ${grossCollected.toLocaleString('it-IT')} € `
        + `oltre la soglia di ${sogliaCessazioneImmediata.toLocaleString('it-IT')} €. `
        + 'Il regime forfettario cessa immediatamente: dalla fattura che ha '
        + 'determinato il superamento devi applicare l\'IVA ordinaria.',
      suggestedAction: 'Verifica con il commercialista: passaggio a regime '
        + 'ordinario con effetto dalla fattura di superamento (L. 197/2022 '
        + 'art. 1 c. 71).',
      context: {
        grossCollected,
        sogliaCessazioneImmediata,
        eccedenza: grossCollected - sogliaCessazioneImmediata,
      },
    };
  }

  if (grossCollected > sogliaIngresso) {
    return {
      code: 'C1_SOGLIA_85K_SUPERATA',
      severity: 'warning',
      title: 'Soglia 85.000 € superata',
      message: `Hai incassato ${grossCollected.toLocaleString('it-IT')} €, `
        + `oltre la soglia di ${sogliaIngresso.toLocaleString('it-IT')} €. `
        + 'Resterai in forfettario fino a fine anno, ma dal prossimo periodo '
        + 'd\'imposta passerai al regime ordinario (L. 197/2022 art. 1 c. 54).',
      suggestedAction: 'Pianifica la transizione al regime ordinario per '
        + 'l\'anno successivo. Attenzione a non superare i 100.000 € o il '
        + 'regime cessa subito.',
      context: {
        grossCollected,
        sogliaIngresso,
        sogliaCessazioneImmediata,
        margineResiduo: sogliaCessazioneImmediata - grossCollected,
      },
    };
  }

  return null;
}

/**
 * A1 — Aliquota sostitutiva ridotta 5% startup (art. 1 c. 65 L. 190/2014).
 * - Aliquota diversa da 5%: nessun controllo (non riguarda il check).
 * - 5% e `anno - annoInizioAttività < 5`: info, conferma i requisiti.
 * - 5% e `anno - annoInizioAttività ≥ 5`: block, l'aliquota non è ammessa
 *   per l'anno selezionato.
 */
export function checkA1_sostitutivaStartup(ctx: AuditContext): AuditWarning | null {
  const { yearSettings, profile, year } = ctx;
  if (yearSettings.impostaSostitutiva !== FORFETTARIO_RULES.sostitutivaStartup) {
    return null;
  }

  const annoInizio = yearOf(profile.dataInizioAttivita);
  const valido = isAnnoStartupValido(annoInizio, year);
  const anniTrascorsi = year - annoInizio;

  if (!valido) {
    return {
      code: 'A1_SOSTITUTIVA_5_NON_AMMESSA',
      severity: 'block',
      title: 'Aliquota 5% non ammessa',
      message: `Hai impostato la sostitutiva al 5% startup, ma per il ${year} `
        + `sono trascorsi ${anniTrascorsi} anni dall'inizio attività `
        + `(${profile.dataInizioAttivita}). L'agevolazione vale solo per i `
        + `primi ${FORFETTARIO_RULES.startupMaxAnni} periodi d'imposta `
        + '(art. 1 c. 65 L. 190/2014).',
      suggestedAction: `Imposta la sostitutiva al ${FORFETTARIO_RULES.sostitutivaStandard * 100}% `
        + 'standard per evitare un calcolo errato delle imposte.',
      context: {
        year,
        annoInizioAttivita: annoInizio,
        anniTrascorsi,
        startupMaxAnni: FORFETTARIO_RULES.startupMaxAnni,
      },
    };
  }

  return {
    code: 'A1_SOSTITUTIVA_5_REQUISITI',
    severity: 'info',
    title: 'Verifica requisiti aliquota 5%',
    message: `Stai usando la sostitutiva ridotta al 5% startup per il ${year}. `
      + `Sei al ${anniTrascorsi + 1}° periodo d'imposta dall'inizio attività `
      + `(${profile.dataInizioAttivita}). L'agevolazione richiede anche di `
      + 'non aver svolto attività analoga nei 3 anni precedenti e di non '
      + 'essere mera prosecuzione di lavoro dipendente (art. 1 c. 65 L. 190/2014).',
    suggestedAction: 'Conferma con il commercialista che i requisiti '
      + 'oggettivi sono soddisfatti.',
    context: {
      year,
      annoInizioAttivita: annoInizio,
      anniTrascorsi,
      startupMaxAnni: FORFETTARIO_RULES.startupMaxAnni,
    },
  };
}

/**
 * M1 — Riduzione 35% INPS artigiani/commercianti non comunicata.
 * La riduzione opera solo se l'iscritto ne fa domanda a INPS entro il 28/02
 * dell'anno (art. 1 c. 77 L. 190/2014). Se il flag `riduzione_35` è attivo
 * ma `riduzione_35_comunicata` non lo è, l'utente sta calcolando contributi
 * ridotti senza titolo: l'INPS chiederà la differenza.
 */
export function checkM1_riduzione35NonComunicata(ctx: AuditContext): AuditWarning | null {
  const { riduzione_35, riduzione_35_comunicata } = ctx.yearSettings;
  if (riduzione_35 !== 1) return null;
  if (riduzione_35_comunicata === 1) return null;

  return {
    code: 'M1_RIDUZIONE_35_NON_COMUNICATA',
    severity: 'warning',
    title: 'Riduzione 35% non comunicata a INPS',
    message: 'Hai attivato la riduzione 35% dei contributi INPS artigiani/'
      + 'commercianti, ma non hai confermato di aver inviato la comunicazione '
      + 'a INPS entro il 28/02. Senza domanda formale la riduzione non opera '
      + '(art. 1 c. 77 L. 190/2014) e INPS chiederà i contributi pieni.',
    suggestedAction: 'Invia la comunicazione tramite Cassetto Previdenziale '
      + 'INPS e poi spunta "Comunicata a INPS" nelle impostazioni dell\'anno.',
    context: {
      year: ctx.year,
      riduzione_35,
      riduzione_35_comunicata,
    },
  };
}

/**
 * Info — Nessuna fonte di ricavo registrata. Non è un finding dell'audit,
 * ma un suggerimento UX: se l'utente apre l'anno e non ha incassi, il
 * dashboard può proporgli import legacy / inserimento manuale.
 */
function checkNoRevenueSource(ctx: AuditContext): AuditWarning | null {
  if (ctx.grossCollected !== 0) return null;
  return {
    code: 'NO_REVENUE_SOURCE',
    severity: 'info',
    title: 'Nessun incasso registrato',
    message: `Per il ${ctx.year} non risultano ancora incassi. Le simulazioni `
      + 'fiscali e le scadenze useranno valori a zero finché non inserisci '
      + 'fatture/pagamenti o importi i dati da CalcoliVari.',
    suggestedAction: 'Aggiungi una fattura o importa il backup JSON da '
      + 'CalcoliVari per popolare l\'anno.',
    context: { year: ctx.year },
  };
}

/**
 * Esegue tutti i check disponibili sul contesto fornito e restituisce
 * l'elenco delle warning attive. L'ordine riflette la priorità d'esposizione
 * in UI: prima i `block`/`warning` fiscali, poi le info di contesto.
 */
export function evaluateAuditChecks(ctx: AuditContext): AuditWarning[] {
  const out: AuditWarning[] = [];
  const c1 = checkC1_soglia(ctx);
  if (c1) out.push(c1);
  const a1 = checkA1_sostitutivaStartup(ctx);
  if (a1) out.push(a1);
  const m1 = checkM1_riduzione35NonComunicata(ctx);
  if (m1) out.push(m1);
  const noRevenue = checkNoRevenueSource(ctx);
  if (noRevenue) out.push(noRevenue);
  return out;
}
