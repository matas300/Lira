// Soglie acconto art. 17 c. 3 DPR 435/2001 + ripartizione rate per i
// forfettari (soggetti ISA): art. 58 DL 124/2019 conv. L. 157/2019 e
// Ris. AdE 93/E/2019 — gli acconti dell'imposta sostitutiva si versano in
// DUE RATE DI PARI IMPORTO (50% + 50%), non più 40/60.
//
// Soglie (valgono per le IMPOSTE, non per i contributi — vedi
// buildContributiAccontoPlan nel tax-engine):
// - imposta <  51,65 €  → nessun acconto
// - 51,65 ≤ imposta < 257,52 € → unica rata a novembre (100%)
// - imposta ≥ 257,52 € → due rate 50/50 (boundary INCLUSO nello split)
//
// Riferimento normativo unico per evitare hard-coded magic numbers nel tax engine.
export const ACCONTO_RULES = Object.freeze({
  thresholdZero: 51.65,
  thresholdSingle: 257.52,
  // Art. 58 DL 124/2019: 50% + 50% per i soggetti ISA (forfettari inclusi).
  weights: Object.freeze([50, 50] as const),
});

export type AccontoRules = typeof ACCONTO_RULES;
