// Soglie acconto art. 17 c. 3 DPR 435/2001.
// Riferimento normativo unico per evitare hard-coded magic numbers nel tax engine.
export const ACCONTO_RULES = Object.freeze({
  thresholdZero: 51.65,
  thresholdSingle: 257.52,
  weights: Object.freeze([40, 60] as const),
});

export type AccontoRules = typeof ACCONTO_RULES;
