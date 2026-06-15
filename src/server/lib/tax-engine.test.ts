// src/server/lib/tax-engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccontoPlan,
  buildContributiAccontoPlan,
  buildForfettarioScenario,
  buildForfettarioMethodComparison,
  buildTransitionDiagnostics,
  buildInstallmentStatus,
  buildInstallmentExplanation,
  calcContributiVariabiliArtCom,
  calcContributiVariabiliGs,
  ceil2,
  type ScenarioInput,
  type ScheduleRow,
} from './tax-engine';
import { getInpsArtComForYear, getInpsGsForYear } from '@shared/inps-params';

// --- ceil2 (fix audit: FP-safe) -------------------------------------------

test('ceil2: FP-safe — niente cent fantasma su importi reali (4460.64)', () => {
  assert.equal(ceil2(4460.64), 4460.64);
});

test('ceil2: assorbe il noise IEEE 754 (0.1 + 0.2 → 0.30, non 0.31)', () => {
  assert.equal(ceil2(0.1 + 0.2), 0.3);
});

test('ceil2: ceil vero sulla terza cifra decimale reale (724.854 → 724.86)', () => {
  assert.equal(ceil2(724.854), 724.86);
  assert.equal(ceil2(3853.404), 3853.41);
});

test('ceil2: zero e falsy → 0', () => {
  assert.equal(ceil2(0), 0);
  assert.equal(ceil2(NaN), 0);
});

// --- buildAccontoPlan (imposte: soglie art. 17 c. 3 DPR 435/2001 + 50/50) --

test('buildAccontoPlan: importo 0 → mode none', () => {
  const p = buildAccontoPlan(0);
  assert.equal(p.mode, 'none');
  assert.equal(p.total, 0);
  assert.equal(p.first, 0);
  assert.equal(p.second, 0);
});

test('buildAccontoPlan: boundary 51.64 → mode none', () => {
  assert.equal(buildAccontoPlan(51.64).mode, 'none');
});

test('buildAccontoPlan: boundary esatto 51.65 → mode single (51,65 ≤ x < 257,52)', () => {
  const p = buildAccontoPlan(51.65);
  assert.equal(p.mode, 'single');
  assert.equal(p.first, 0);
  assert.equal(p.second, 51.65);
});

test('buildAccontoPlan: boundary 257.51 → mode single', () => {
  const p = buildAccontoPlan(257.51);
  assert.equal(p.mode, 'single');
  assert.equal(p.second, 257.51);
});

test('FIX BOUNDARY: a esattamente 257.52 il piano è SPLIT (≥, non >)', () => {
  const p = buildAccontoPlan(257.52);
  assert.equal(p.mode, 'double');
  assert.equal(p.first, 128.76);
  assert.equal(p.second, 128.76);
});

test('buildAccontoPlan: rate di PARI importo 50/50 (art. 58 DL 124/2019, Ris. AdE 93/E/2019)', () => {
  const p = buildAccontoPlan(3000);
  assert.equal(p.mode, 'double');
  assert.equal(p.first, 1500);
  assert.equal(p.second, 1500);
});

test('buildAccontoPlan: 257.53 → double con somma esatta e rate quasi pari', () => {
  const p = buildAccontoPlan(257.53);
  assert.equal(p.mode, 'double');
  // ceil2(128.765) = 128.77 sulla prima, compensazione sulla seconda.
  assert.equal(p.first, 128.77);
  assert.equal(p.second, 128.76);
  assert.equal(ceil2(p.first + p.second), 257.53);
});

// --- buildContributiAccontoPlan (fix audit: piano contributivo separato) ---

test('buildContributiAccontoPlan art/com: 50/50 SENZA soglie (anche sotto 257.52)', () => {
  const p = buildContributiAccontoPlan(100, 'artigiani_commercianti');
  assert.equal(p.mode, 'double');
  assert.equal(p.first, 50);
  assert.equal(p.second, 50);
  assert.equal(p.total, 100);
});

test('buildContributiAccontoPlan art/com: base 0 → none', () => {
  const p = buildContributiAccontoPlan(0, 'artigiani_commercianti');
  assert.equal(p.mode, 'none');
  assert.equal(p.total, 0);
});

test('buildContributiAccontoPlan art/com: centesimo dispari compensato, somma esatta', () => {
  const p = buildContributiAccontoPlan(100.01, 'artigiani_commercianti');
  assert.equal(p.first, 50.01);
  assert.equal(p.second, 50);
  assert.equal(ceil2(p.first + p.second), 100.01);
});

test('buildContributiAccontoPlan GS: 80% del presunto in due rate del 40%', () => {
  const p = buildContributiAccontoPlan(1000, 'gestione_separata');
  assert.equal(p.mode, 'double');
  assert.equal(p.base, 1000);
  assert.equal(p.total, 800);
  assert.equal(p.first, 400);
  assert.equal(p.second, 400);
});

test('buildContributiAccontoPlan GS: arrotondamenti coerenti (somma rate = total)', () => {
  const p = buildContributiAccontoPlan(1234.57, 'gestione_separata');
  assert.equal(p.total, 987.66);
  assert.equal(ceil2(p.first + p.second), p.total);
});

// --- calcContributiVariabiliArtCom (fix audit: variabile mai calcolata) ----

test('variabile art/com: reddito sotto minimale → 0', () => {
  const params = getInpsArtComForYear(2025);
  const v = calcContributiVariabiliArtCom({
    redditoLordo: 10_000,
    params,
    categoria: 'artigiano',
    riduzione35: false,
  });
  assert.equal(v, 0);
});

test('variabile artigiano 2025: 24% × (reddito − minimale) in prima fascia', () => {
  const params = getInpsArtComForYear(2025);
  // Caso Mattia: reddito lordo 30150 → 0.24 × (30150 − 18555) = 2782.80
  const v = calcContributiVariabiliArtCom({
    redditoLordo: 30_150,
    params,
    categoria: 'artigiano',
    riduzione35: false,
  });
  assert.equal(v, 2782.8);
});

test('variabile artigiano 2025: seconda fascia +1 p.p. oltre 55448 (art. 3-ter L. 438/1992)', () => {
  const params = getInpsArtComForYear(2025);
  // 0.24 × (55448 − 18555) + 0.25 × (60000 − 55448) = 8854.32 + 1138 = 9992.32
  const v = calcContributiVariabiliArtCom({
    redditoLordo: 60_000,
    params,
    categoria: 'artigiano',
    riduzione35: false,
  });
  assert.equal(v, 9992.32);
});

test('variabile artigiano 2025: cap al massimale 120607', () => {
  const params = getInpsArtComForYear(2025);
  // 0.24 × (55448 − 18555) + 0.25 × (120607 − 55448) = 8854.32 + 16289.75 = 25144.07
  const v = calcContributiVariabiliArtCom({
    redditoLordo: 200_000,
    params,
    categoria: 'artigiano',
    riduzione35: false,
  });
  assert.equal(v, 25_144.07);
});

test('variabile commerciante 2025: aliquote 24,48% / 25,48%', () => {
  const params = getInpsArtComForYear(2025);
  // 0.2448 × (55448 − 18555) + 0.2548 × (60000 − 55448)
  //   = 9031.4064 + 1159.8496 = 10191.256 → ceil2 = 10191.26
  const v = calcContributiVariabiliArtCom({
    redditoLordo: 60_000,
    params,
    categoria: 'commerciante',
    riduzione35: false,
  });
  assert.equal(v, 10_191.26);
});

test('variabile art/com: riduzione 35% si applica anche alla variabile (× 0.65)', () => {
  const params = getInpsArtComForYear(2025);
  // 2782.80 × 0.65 = 1808.82
  const v = calcContributiVariabiliArtCom({
    redditoLordo: 30_150,
    params,
    categoria: 'artigiano',
    riduzione35: true,
  });
  assert.equal(v, 1808.82);
});

// --- calcContributiVariabiliGs ---------------------------------------------

test('variabile GS 2025: aliquota 26,07% senza altra cassa, nessun minimale', () => {
  const params = getInpsGsForYear(2025);
  // 0.2607 × 33500 = 8733.45 (proporzionale dal primo euro)
  const v = calcContributiVariabiliGs({ redditoLordo: 33_500, params, altraCassa: false });
  assert.equal(v, 8733.45);
});

test('variabile GS 2025: aliquota 24% con altra cassa', () => {
  const params = getInpsGsForYear(2025);
  const v = calcContributiVariabiliGs({ redditoLordo: 33_500, params, altraCassa: true });
  assert.equal(v, 8040);
});

test('variabile GS 2025: cap al massimale 120607', () => {
  const params = getInpsGsForYear(2025);
  // 0.2607 × 120607 = 31442.2449 → ceil2 = 31442.25
  const v = calcContributiVariabiliGs({ redditoLordo: 134_000, params, altraCassa: false });
  assert.equal(v, 31_442.25);
});

// --- buildForfettarioScenario (Task 10 + fix A6 + fix variabile INPS) ------

function baseScenarioInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  const inps2025 = getInpsArtComForYear(2025);
  return {
    year: 2025,
    method: 'storico',
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, riduzione35: false },
    grossCollected: 50_000,
    currentContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps2025.quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 0,
    },
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: inps2025.quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 0,
    },
    previousTaxBase: 4500,
    previousContributionAccontiPaid: 0,
    accontiSostitutivaPagatiReali: 0,
    accontiContribPagatiReali: 0,
    ...overrides,
  };
}

test('buildForfettarioScenario: ricavi 50k coeff 67% → reddito lordo 33500', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.forfettarioGrossIncome, 33_500);
});

test('FIX FP: quota fissa 4460.64 → 4 rate UGUALI da 1115.16 (valore F24 INPS)', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  // previousFixedTail = rata 4 anno scorso; currentFixedWithinYear = rate 1-3.
  assert.equal(r.previousFixedTail, 1115.16);
  assert.equal(r.currentFixedWithinYear, 3345.48);
  // Totale fissi dell'anno = quota fissa annua esatta, non 4460.66.
  assert.equal(r.deductibleContributionsPaid, 4460.64);
});

test('buildForfettarioScenario: sostitutiva calcolata su imponibile netto contributi', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.ok(r.taxableBase < r.forfettarioGrossIncome);
  assert.equal(r.taxableBase, 29_039.36); // 33500 − 4460.64
  assert.equal(r.substituteTax, ceil2(r.taxableBase * 0.15)); // 4355.91
  assert.equal(r.substituteTax, 4355.91);
});

test('buildForfettarioScenario: sostitutiva 5% startup', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.05, riduzione35: false },
  }));
  assert.equal(r.substituteTax, ceil2(r.taxableBase * 0.05));
});

test('FIX VARIABILE: contributiVariabiliDovuti calcolati sul reddito LORDO (Circ. INPS 35/2016)', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  // 0.24 × (33500 − 18555) = 3586.80 — base ANTE deduzione contributi.
  assert.equal(r.contributiVariabiliDovuti, 3586.8);
});

test('FIX VARIABILE: contributionSaldo = variabile dovuta − acconti contributi reali', () => {
  const r = buildForfettarioScenario(baseScenarioInput({ accontiContribPagatiReali: 800 }));
  assert.equal(r.contributionSaldo, 2786.8); // 3586.80 − 800
});

test('FIX VARIABILE: riduzione 35% attiva → variabile × 0.65', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    settings: { coefficiente: 0.67, impostaSostitutiva: 0.15, riduzione35: true },
  }));
  assert.equal(r.contributiVariabiliDovuti, ceil2(3586.8 * 0.65)); // 2331.42
});

test('FIX VARIABILE: anno senza parametri INPS pubblicati → variabile 0 senza throw', () => {
  const r = buildForfettarioScenario(baseScenarioInput({ year: 2099 }));
  assert.equal(r.contributiVariabiliDovuti, 0);
});

test('FIX VARIABILE GS: contributo proporzionale, niente quota fissa', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    currentContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
    previousContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
  }));
  assert.equal(r.previousFixedTail, 0);
  assert.equal(r.contributiVariabiliDovuti, 8733.45); // 0.2607 × 33500
});

test('FIX VARIABILE GS: altraCassa → aliquota 24%', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    currentContribution: {
      mode: 'gestione_separata',
      fixedAnnual: 0,
      saldoAccontoBase: 0,
      altraCassa: true,
    },
    previousContribution: { mode: 'gestione_separata', fixedAnnual: 0, saldoAccontoBase: 0 },
  }));
  assert.equal(r.contributiVariabiliDovuti, 8040); // 0.24 × 33500
});

test('FIX VARIABILE: categoria commerciante → aliquota 24,48%', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    currentContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: getInpsArtComForYear(2025).quotaFissaAnnuaCommerciante,
      saldoAccontoBase: 0,
      categoria: 'commerciante',
    },
  }));
  // 0.2448 × (33500 − 18555) = 0.2448 × 14945 = 3658.536 → ceil2 = 3658.54
  assert.equal(r.contributiVariabiliDovuti, 3658.54);
});

test('FIX PIANO CONTRIBUTI: acconti contributi storico = 50/50 della variabile anno prec, senza soglie', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    previousContribution: {
      mode: 'artigiani_commercianti',
      fixedAnnual: getInpsArtComForYear(2025).quotaFissaAnnuaArtigiano,
      saldoAccontoBase: 200, // sotto la soglia single delle imposte (257.52)
    },
  }));
  assert.equal(r.contributionAccontoBase, 200);
  assert.equal(r.contributionAcconti.mode, 'double'); // niente soglie per i contributi
  assert.equal(r.contributionAcconti.first, 100);
  assert.equal(r.contributionAcconti.second, 100);
});

// --- METODO PREVISIONALE (fix audit: unità di misura = RICAVI previsti) ----

test('FIX PREVISIONALE: forecastGrossCollected (ricavi) → imposta e contributi previsti interni', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    method: 'previsionale',
    forecastGrossCollected: 40_000,
  }));
  assert.equal(r.method, 'previsionale');
  assert.equal(r.forecastGrossCollected, 40_000);
  assert.equal(r.forecastGrossIncome, 26_800); // 40000 × 0.67
  // Variabile prevista: 0.24 × (26800 − 18555) = 1978.80
  assert.equal(r.forecastContributiVariabili, 1978.8);
  assert.equal(r.contributionAccontoBase, 1978.8);
  assert.equal(r.contributionAcconti.first, 989.4);
  assert.equal(r.contributionAcconti.second, 989.4);
  // Deduzione: fissi 4460.64 + acconti variabili 1978.80 = 6439.44.
  assert.equal(r.deductibleContributionsPaid, 6439.44);
  // Imposta prevista: 0.15 × (26800 − 6439.44) = 0.15 × 20360.56 = 3054.084 → 3054.09
  assert.equal(r.forecastTaxableBase, 20_360.56);
  assert.equal(r.forecastSubstituteTax, 3054.09);
  assert.equal(r.taxAccontoBase, 3054.09);
});

test('FIX PREVISIONALE: forecastGrossCollected omesso → fallback ai ricavi correnti', () => {
  const r = buildForfettarioScenario(baseScenarioInput({ method: 'previsionale' }));
  assert.equal(r.forecastGrossCollected, r.grossCollected);
  assert.equal(r.forecastGrossIncome, r.forfettarioGrossIncome);
  assert.equal(r.forecastContributiVariabili, r.contributiVariabiliDovuti);
});

test('metodo storico: taxAccontoBase = imposta anno precedente (previousTaxBase)', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.taxAccontoBase, 4500);
  assert.equal(r.taxAcconti.first, 2250); // 50/50
  assert.equal(r.taxAcconti.second, 2250);
});

// --- Deduzione per cassa (fix audit: contributi effettivamente versati) ----

test('FIX CASSA: contributiVersatiAnno fornito → sostituisce la stima da piano', () => {
  const r = buildForfettarioScenario(baseScenarioInput({ contributiVersatiAnno: 5000 }));
  assert.equal(r.deductibleContributionsPaid, 5000);
  assert.equal(r.taxableBase, 28_500); // 33500 − 5000
  assert.equal(r.substituteTax, 4275); // 0.15 × 28500
});

test('FIX CASSA: contributiVersatiAnno = 0 è onorato (anno senza versamenti)', () => {
  const r = buildForfettarioScenario(baseScenarioInput({ contributiVersatiAnno: 0 }));
  assert.equal(r.deductibleContributionsPaid, 0);
  assert.equal(r.taxableBase, 33_500);
});

test('FIX CASSA: contributiVersatiAnno omesso → fallback al piano', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.deductibleContributionsPaid, 4460.64);
});

// --- A6 (acconti reali) -----------------------------------------------------

test('A6 fix: saldo sostitutiva sottrae accontiSostitutivaPagatiReali', () => {
  const stimati = buildForfettarioScenario(baseScenarioInput({ accontiSostitutivaPagatiReali: 0 }));
  const reali = buildForfettarioScenario(baseScenarioInput({ accontiSostitutivaPagatiReali: 1500 }));
  assert.equal(stimati.taxSaldo, stimati.substituteTax);
  assert.equal(reali.taxSaldo, ceil2(Math.max(reali.substituteTax - 1500, 0)));
});

test('A6 fix: se acconti pagati > tax computed → saldo = 0', () => {
  const r = buildForfettarioScenario(baseScenarioInput({
    grossCollected: 10_000,
    accontiSostitutivaPagatiReali: 5_000,
  }));
  assert.equal(r.taxSaldo, 0);
});

test('buildForfettarioScenario: formula breakdown contiene 5 voci', () => {
  const r = buildForfettarioScenario(baseScenarioInput());
  assert.equal(r.formula.length, 5);
  assert.equal(r.formula[0]?.label, 'Ricavi incassati');
});

// --- buildTransitionDiagnostics (Task 12) -------------------------------

test('buildTransitionDiagnostics: nessun cambiamento → warnings vuote', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario', haRedditoDipendente: 0 },
    previousSettings: { regime: 'forfettario', haRedditoDipendente: 0 },
  });
  assert.equal(r.warnings.length, 0);
  assert.equal(r.isRegimeTransition, false);
});

test('buildTransitionDiagnostics: cambio regime → warning', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario' },
    previousSettings: { regime: 'ordinario' },
  });
  assert.equal(r.isRegimeTransition, true);
  assert.ok(r.warnings.length > 0);
});

test('buildTransitionDiagnostics: anno precedente reddito misto → warning', () => {
  const r = buildTransitionDiagnostics({
    year: 2026,
    currentSettings: { regime: 'forfettario' },
    previousSettings: { regime: 'forfettario', haRedditoDipendente: 1 },
  });
  assert.equal(r.previousHadEmployeeIncome, true);
  assert.ok(r.warnings.some((w) => /dipendente/i.test(w)));
});

// --- buildForfettarioMethodComparison (Task 11) -------------------------

test('buildForfettarioMethodComparison: produce sia historical che previsionale', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastGrossCollected: 48_000,
  });
  assert.ok(out.historical);
  assert.ok(out.previsionale);
  assert.equal(out.historical.method, 'storico');
  assert.equal(out.previsionale.method, 'previsionale');
});

test('buildForfettarioMethodComparison: prudential è il metodo con managedCashOutflows piu alto', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastGrossCollected: 10_000,
  });
  assert.ok(out.prudential === 'historical' || out.prudential === 'previsionale');
});

test('buildForfettarioMethodComparison: warnings include un messaggio quando deltaCash differisce', () => {
  const out = buildForfettarioMethodComparison({
    ...baseScenarioInput(),
    methodSetting: 'storico',
    forecastGrossCollected: 10_000,
  });
  assert.ok(out.warnings.length > 0);
});

// --- buildInstallmentStatus + buildInstallmentExplanation (Task 13) -------

function baseRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'imposta_saldo_2025',
    family: 'imposta_saldo',
    kind: 'tax',
    competence: 'Saldo 2025',
    title: 'Imposta sostitutiva - saldo',
    method: 'Storico',
    amount: 1000,
    low: 1000,
    high: 1000,
    certainty: 'estimated',
    ...overrides,
  };
}

test('buildInstallmentStatus: nessun pagamento + estimated → estimated', () => {
  const s = buildInstallmentStatus(baseRow({ certainty: 'estimated' }), 0);
  assert.equal(s.code, 'estimated');
});

test('buildInstallmentStatus: nessun pagamento + non estimated → to_confirm', () => {
  const s = buildInstallmentStatus(baseRow({ certainty: 'official' }), 0);
  assert.equal(s.code, 'to_confirm');
});

test('buildInstallmentStatus: pagamento esatto → paid', () => {
  const s = buildInstallmentStatus(baseRow(), 1000);
  assert.equal(s.code, 'paid');
});

test('buildInstallmentStatus: pagamento sotto range → underpaid', () => {
  const s = buildInstallmentStatus(baseRow({ amount: 1000, low: 900, high: 1100 }), 800);
  assert.equal(s.code, 'underpaid');
});

test('buildInstallmentStatus: pagamento sopra range → overpaid', () => {
  const s = buildInstallmentStatus(baseRow({ amount: 1000, low: 900, high: 1100 }), 1200);
  assert.equal(s.code, 'overpaid');
});

test('buildInstallmentExplanation: imposta_saldo → menziona "chiude l\'imposta"', () => {
  const ex = buildInstallmentExplanation(baseRow());
  assert.match(ex, /chiude.*imposta/i);
});
