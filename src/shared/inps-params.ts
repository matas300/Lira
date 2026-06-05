// Parametri INPS annuali per Partita IVA forfettaria.
//
// Due gestioni supportate:
// - Artigiani/Commercianti (IVS): quota fissa annua sul minimale + quota
//   variabile sulla parte eccedente. Aliquote: 24% artigiani, 24,48%
//   commercianti (+0,48 p.p. art. 5 L. 160/2019 - tassa scopi previdenziali).
// - Gestione Separata (L. 335/1995 art. 2 c. 26): contributo proporzionale
//   senza minimale, capped al massimale annuo. Aliquote: 26,07% senza altra
//   cassa, 24% con altra cassa/pensionato.
//
// Fonti dei valori (porting da CalcoliVari/app.js, righe 382-451):
// - Artigiani/Commercianti: Circolare INPS 33/2024 (anno 2024), 38/2025 (2025).
// - Gestione Separata aliquote: Circolare INPS 24/2024, 26/2025.
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
  // aggiuntivo fisso art. 5 L. 160/2019). Esempio 2025: 18555 * 0.24 + 7.44.
  quotaFissaAnnua: number;
  // Quota fissa annua commerciante = minimale * 0.2448 + 7.44. Differisce
  // da artigiano per la maggiorazione 0,48 p.p. (tassa scopi previdenziali
  // INVS commercianti, art. 5 L. 160/2019).
  quotaFissaAnnuaCommerciante: number;
  aliquota: number; // artigiano (0.24)
  aliquotaCommerciante: number; // commerciante (0.2448)
  massimale: number;
}

export interface InpsGsParams {
  aliquotaSenzaAltraCassa: number;
  aliquotaConAltraCassa: number;
  massimale: number;
}

export const INPS_ARTCOM: Record<number, InpsArtComParams> = Object.freeze({
  2024: Object.freeze({
    minimaleAnnuo: 18415,
    quotaFissaAnnua: 4427.04,
    quotaFissaAnnuaCommerciante: 4515.43,
    aliquota: 0.24,
    aliquotaCommerciante: 0.2448,
    massimale: 119650,
  }),
  2025: Object.freeze({
    minimaleAnnuo: 18555,
    quotaFissaAnnua: 4460.64,
    quotaFissaAnnuaCommerciante: 4549.70,
    aliquota: 0.24,
    aliquotaCommerciante: 0.2448,
    massimale: 120607,
  }),
});

export const INPS_GS: Record<number, InpsGsParams> = Object.freeze({
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
