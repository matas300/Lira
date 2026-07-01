// Parametri INPS annuali per Partita IVA forfettaria.
//
// Due gestioni supportate:
// - Artigiani/Commercianti (IVS - Invalidità, Vecchiaia, Superstiti): quota
//   fissa annua sul minimale + quota variabile sulla parte eccedente.
//   Aliquote: 24% artigiani, 24,48% commercianti (+0,48 p.p. contributo
//   aggiuntivo per indennizzo cessazione attività commerciali, L. 662/1996
//   art. 1 c. 16).
// - Gestione Separata (L. 335/1995 art. 2 c. 26): contributo proporzionale
//   senza minimale, capped al massimale annuo. Aliquote: 26,07% senza altra
//   cassa, 24% con altra cassa/pensionato.
//
// Fonti dei valori (porting da CalcoliVari/app.js, righe 382-451):
// - Artigiani/Commercianti: Circolare INPS 33/2024 (anno 2024), 38/2025 (2025),
//   14/2026 (2026, del 9/02/2026).
// - Gestione Separata aliquote: Circolare INPS 24/2024, 26/2025, 8/2026
//   (del 3/02/2026).
// - Gestione Separata massimale (= massimale L. 335/95 art. 2 c. 18):
//   Circolari annuali INPS.
//
// Nota sul massimale Art/Com: la legge fissa per i lavoratori autonomi
// iscritti dopo il 1996 il medesimo massimale della L. 335/95 (= quello
// usato per la Gestione Separata). In CalcoliVari questo valore vive in
// un'unica tabella; qui lo replichiamo nella shape Art/Com per chiarezza
// e per evitare dipendenze incrociate fra i due record.

export interface InpsArtComParams {
  minimaleAnnuo: number;
  // Quota fissa annua artigiano = minimale * 0.24 + 7.44 (contributo
  // maternità fisso, D.M. 12/02/1985 ex L. 1204/1971). Esempio 2025:
  // 18555 * 0.24 + 7.44.
  quotaFissaAnnuaArtigiano: number;
  // Quota fissa annua commerciante = minimale * 0.2448 + 7.44. Differisce
  // da artigiano per la maggiorazione 0,48 p.p. (contributo aggiuntivo per
  // indennizzo cessazione attività commerciali, L. 662/1996 art. 1 c. 16).
  quotaFissaAnnuaCommerciante: number;
  aliquotaArtigiano: number; // 0.24
  aliquotaCommerciante: number; // 0.2448
  // Fascia di reddito oltre la quale scatta la maggiorazione di 1 punto
  // percentuale sull'aliquota della quota variabile (art. 3-ter DL 384/1992
  // conv. L. 438/1992). Valore pubblicato ogni anno nella circolare INPS
  // Artigiani/Commercianti — da riscontrare su circolare INPS annuale.
  fasciaRedditoAliquotaMaggiorata: number;
  // Aliquote maggiorate (+1 p.p.) applicate alla parte di reddito oltre la
  // fascia, fino al massimale. Esplicitate (non derivate con +0.01) per
  // fedeltà alla circolare e per evitare noise FP (0.2448 + 0.01 ≠ 0.2548
  // in IEEE 754).
  aliquotaArtigianoOltreFascia: number; // 0.25
  aliquotaCommercianteOltreFascia: number; // 0.2548
  massimale: number;
}

export interface InpsGsParams {
  aliquotaSenzaAltraCassa: number;
  aliquotaConAltraCassa: number;
  massimale: number;
}

export const INPS_ARTCOM: Readonly<Record<number, Readonly<InpsArtComParams>>> = Object.freeze({
  2024: Object.freeze({
    minimaleAnnuo: 18415,
    quotaFissaAnnuaArtigiano: 4427.04,
    quotaFissaAnnuaCommerciante: 4515.43,
    aliquotaArtigiano: 0.24,
    aliquotaCommerciante: 0.2448,
    // Circolare INPS 33/2024 — da riscontrare su circolare INPS annuale.
    fasciaRedditoAliquotaMaggiorata: 55008,
    aliquotaArtigianoOltreFascia: 0.25,
    aliquotaCommercianteOltreFascia: 0.2548,
    massimale: 119650,
  }),
  2025: Object.freeze({
    minimaleAnnuo: 18555,
    quotaFissaAnnuaArtigiano: 4460.64,
    quotaFissaAnnuaCommerciante: 4549.70,
    aliquotaArtigiano: 0.24,
    aliquotaCommerciante: 0.2448,
    // Circolare INPS 38/2025 — da riscontrare su circolare INPS annuale.
    fasciaRedditoAliquotaMaggiorata: 55448,
    aliquotaArtigianoOltreFascia: 0.25,
    aliquotaCommercianteOltreFascia: 0.2548,
    massimale: 120607,
  }),
  2026: Object.freeze({
    minimaleAnnuo: 18808,
    // quota fissa = minimale * aliquota + 7,44 (maternità). Valori pubblicati
    // in Circolare INPS 14/2026: artigiano 4.521,36 · commerciante 4.611,64.
    quotaFissaAnnuaArtigiano: 4521.36,
    quotaFissaAnnuaCommerciante: 4611.64,
    aliquotaArtigiano: 0.24,
    aliquotaCommerciante: 0.2448,
    // Circolare INPS 14/2026: prima fascia (oltre cui +1 p.p.) 56.224 €.
    fasciaRedditoAliquotaMaggiorata: 56224,
    aliquotaArtigianoOltreFascia: 0.25,
    aliquotaCommercianteOltreFascia: 0.2548,
    // Massimale iscritti post-1996 (L. 335/95): 122.295 €.
    massimale: 122295,
  }),
});

export const INPS_GS: Readonly<Record<number, Readonly<InpsGsParams>>> = Object.freeze({
  2024: Object.freeze({
    aliquotaSenzaAltraCassa: 0.2607,
    aliquotaConAltraCassa: 0.24,
    massimale: 119650,
  }),
  2025: Object.freeze({
    aliquotaSenzaAltraCassa: 0.2607,
    aliquotaConAltraCassa: 0.24,
    massimale: 120607,
  }),
  2026: Object.freeze({
    // Circolare INPS 8/2026: 26,07% (25% IVS + 0,72% + 0,35% ISCRO) senza
    // altra cassa; 24% con altra cassa/pensionato. Massimale 122.295 €.
    aliquotaSenzaAltraCassa: 0.2607,
    aliquotaConAltraCassa: 0.24,
    massimale: 122295,
  }),
});

/**
 * Restituisce i parametri INPS Artigiani/Commercianti per l'anno richiesto.
 * Solleva un Error con messaggio contenente "INPS_ARTCOM" e l'anno se l'anno
 * non è presente in tabella (no fallback silenzioso: forziamo il chiamante
 * a gestire esplicitamente gli anni non ancora pubblicati).
 */
export function getInpsArtComForYear(year: number): InpsArtComParams {
  const params = INPS_ARTCOM[year];
  if (!params) {
    throw new Error(
      `INPS_ARTCOM: nessun parametro per l'anno ${year}. Aggiungere la tabella ufficiale (Circolare INPS) prima di simulare ${year}.`,
    );
  }
  return params;
}

/**
 * Restituisce i parametri INPS Gestione Separata per l'anno richiesto.
 * Solleva un Error con messaggio contenente "INPS_GS" e l'anno se mancante.
 */
export function getInpsGsForYear(year: number): InpsGsParams {
  const params = INPS_GS[year];
  if (!params) {
    throw new Error(
      `INPS_GS: nessun parametro per l'anno ${year}. Aggiungere la tabella ufficiale (Circolare INPS) prima di simulare ${year}.`,
    );
  }
  return params;
}
