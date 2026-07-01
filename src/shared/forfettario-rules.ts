// Costanti legali del regime forfettario (porting da CalcoliVari + estensioni
// per Lira). Soglie ricavi, aliquote sostitutiva, riduzione 35% INPS,
// regola startup.
//
// Fonti normative:
// - Soglia ingresso 85.000 €: L. 197/2022 art. 1 c. 54 (lett. a) — innalza
//   la soglia da 65.000 € a 85.000 € a partire dal periodo d'imposta 2023.
// - Soglia cessazione immediata 100.000 €: L. 197/2022 art. 1 c. 71 — se i
//   ricavi/compensi superano 100.000 € nel corso dell'anno, il regime cessa
//   immediatamente (non più dall'anno successivo) e si applica l'IVA dalla
//   fattura che ha determinato il superamento.
// - Aliquota sostitutiva 15%: art. 1 c. 64 L. 190/2014.
// - Aliquota sostitutiva ridotta 5% startup primi 5 anni: art. 1 c. 65 L.
//   190/2014 (requisiti: nuova attività, non mera prosecuzione di lavoro
//   dipendente/autonomo precedente, ricavi entro la soglia).
// - Riduzione 35% INPS artigiani/commercianti: art. 1 c. 77 L. 190/2014
//   (su domanda entro 28/02; coefficiente residuo 65% sui contributi
//   minimali + eccedenza).

export const FORFETTARIO_RULES = Object.freeze({
  sogliaIngresso: 85_000, // L. 197/2022 art. 1 c. 54
  sogliaCessazioneImmediata: 100_000, // L. 197/2022 art. 1 c. 71
  sostitutivaStandard: 0.15, // art. 1 c. 64 L. 190/2014
  sostitutivaStartup: 0.05, // art. 1 c. 65 L. 190/2014
  startupMaxAnni: 5, // art. 1 c. 65 L. 190/2014
  riduzioneInpsCoefficiente: 0.65, // art. 1 c. 77 L. 190/2014 (riduzione 35%)
});

export type ForfettarioRules = typeof FORFETTARIO_RULES;

export const ALIQUOTE_SOSTITUTIVA_AMMESSE = Object.freeze([0.05, 0.15] as const);

export type AliquotaSostitutivaAmmessa = (typeof ALIQUOTE_SOSTITUTIVA_AMMESSE)[number];

/**
 * Restituisce `true` se l'aliquota è una di quelle ammesse dal regime
 * forfettario (5% startup o 15% standard). Confronto strict per evitare
 * coercion implicite.
 */
export function isSostitutivaAmmessa(a: number): boolean {
  return a === FORFETTARIO_RULES.sostitutivaStandard
    || a === FORFETTARIO_RULES.sostitutivaStartup;
}

/**
 * Coefficiente INPS effettivo per la riduzione 35% (art. 1 c. 77 L. 190/2014):
 * la riduzione è OPZIONALE e opera SOLO su domanda telematica a INPS entro il
 * 28/02, a pena di decadenza (Circ. INPS 35/2016). Quindi il coefficiente 0,65
 * si applica solo se la riduzione è attiva **e** comunicata; altrimenti i
 * contributi restano dovuti in misura intera (coefficiente 1).
 *
 * Accetta indifferentemente `number` (0/1 dal DB) o `boolean`.
 */
export function coefficienteRiduzioneInps(
  riduzione35: number | boolean,
  comunicata: number | boolean,
): number {
  const attiva = riduzione35 === 1 || riduzione35 === true;
  const comunicataOk = comunicata === 1 || comunicata === true;
  return attiva && comunicataOk ? FORFETTARIO_RULES.riduzioneInpsCoefficiente : 1;
}

/**
 * `true` se la riduzione 35% è realmente applicabile al calcolo: attiva **e**
 * comunicata a INPS entro il 28/02 (vedi `coefficienteRiduzioneInps`).
 */
export function isRiduzione35Applicabile(
  riduzione35: number | boolean,
  comunicata: number | boolean,
): boolean {
  return coefficienteRiduzioneInps(riduzione35, comunicata) !== 1;
}

/**
 * Verifica se l'anno corrente rientra nei primi 5 periodi d'imposta dalla
 * data inizio attività, soglia oltre la quale decade l'aliquota startup 5%
 * (art. 1 c. 65 L. 190/2014). Formula: `annoCorrente - annoInizioAttivita
 * < startupMaxAnni`, quindi anno 0 (stesso anno di apertura) incluso e
 * anno 5 escluso.
 */
export function isAnnoStartupValido(annoInizioAttivita: number, annoCorrente: number): boolean {
  return annoCorrente - annoInizioAttivita < FORFETTARIO_RULES.startupMaxAnni;
}
