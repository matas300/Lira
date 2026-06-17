// src/client/lib/year-settings-form.ts
// Logica pura dell'editor parametri (year_settings): defaults, mapping
// stato↔body API, opzioni ATECO. Nessun DOM, nessun fetch.

import { atecoGruppiUI } from '@shared/ateco-coefficienti';

export type Regime = 'forfettario' | 'ordinario';
export type InpsMode = 'gestione_separata' | 'artigiani_commercianti';
export type InpsCategoria = 'artigiano' | 'commerciante' | null;
export type ScadenziarioMetodo = 'storico' | 'previsionale';

export interface YsFormState {
  regime: Regime;
  coefficiente: number;
  impostaSostitutiva: number;
  inpsMode: InpsMode;
  inpsCategoria: InpsCategoria;
  riduzione35: boolean;
  riduzione35Comunicata: boolean;
  riduzione35DataComunicazione: string | null;
  haRedditoDipendente: boolean;
  limiteForfettario: number;
  scadenziarioMetodo: ScadenziarioMetodo;
  prorogaSaldoAt: string | null;
  primoAnnoFatturatoPrec: number | null;
  primoAnnoImpostaPrec: number | null;
  primoAnnoAccontiImpostaPrec: number | null;
  primoAnnoContribVariabiliPrec: number | null;
  primoAnnoAccontiContribPrec: number | null;
  tariffaGiornaliera: number | null;
}

export function defaults(): YsFormState {
  return {
    regime: 'forfettario',
    coefficiente: 0.78,
    impostaSostitutiva: 0.15,
    inpsMode: 'gestione_separata',
    inpsCategoria: null,
    riduzione35: false,
    riduzione35Comunicata: false,
    riduzione35DataComunicazione: null,
    haRedditoDipendente: false,
    limiteForfettario: 85000,
    scadenziarioMetodo: 'storico',
    prorogaSaldoAt: null,
    primoAnnoFatturatoPrec: null,
    primoAnnoImpostaPrec: null,
    primoAnnoAccontiImpostaPrec: null,
    primoAnnoContribVariabiliPrec: null,
    primoAnnoAccontiContribPrec: null,
    tariffaGiornaliera: null,
  };
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function stateFromResponse(ys: Record<string, unknown>): YsFormState {
  const d = defaults();
  return {
    regime: (ys['regime'] as Regime) ?? d.regime,
    coefficiente: num(ys['coefficiente']) ?? d.coefficiente,
    impostaSostitutiva: num(ys['impostaSostitutiva']) ?? d.impostaSostitutiva,
    inpsMode: (ys['inpsMode'] as InpsMode) ?? d.inpsMode,
    inpsCategoria: (ys['inpsCategoria'] as InpsCategoria) ?? null,
    riduzione35: ys['riduzione35'] === 1 || ys['riduzione35'] === true,
    riduzione35Comunicata: ys['riduzione35Comunicata'] === 1 || ys['riduzione35Comunicata'] === true,
    riduzione35DataComunicazione: (ys['riduzione35DataComunicazione'] as string | null) ?? null,
    haRedditoDipendente: ys['haRedditoDipendente'] === 1 || ys['haRedditoDipendente'] === true,
    limiteForfettario: num(ys['limiteForfettario']) ?? d.limiteForfettario,
    scadenziarioMetodo: (ys['scadenziarioMetodo'] as ScadenziarioMetodo) ?? d.scadenziarioMetodo,
    prorogaSaldoAt: (ys['prorogaSaldoAt'] as string | null) ?? null,
    primoAnnoFatturatoPrec: num(ys['primoAnnoFatturatoPrec']),
    primoAnnoImpostaPrec: num(ys['primoAnnoImpostaPrec']),
    primoAnnoAccontiImpostaPrec: num(ys['primoAnnoAccontiImpostaPrec']),
    primoAnnoContribVariabiliPrec: num(ys['primoAnnoContribVariabiliPrec']),
    primoAnnoAccontiContribPrec: num(ys['primoAnnoAccontiContribPrec']),
    tariffaGiornaliera: num(ys['tariffaGiornaliera']),
  };
}

export function bodyFromState(s: YsFormState): Record<string, unknown> {
  const riduzione = s.riduzione35;
  return {
    regime: s.regime,
    coefficiente: s.coefficiente,
    impostaSostitutiva: s.impostaSostitutiva,
    inpsMode: s.inpsMode,
    inpsCategoria: s.inpsMode === 'artigiani_commercianti' ? s.inpsCategoria : null,
    riduzione35: riduzione ? 1 : 0,
    riduzione35Comunicata: riduzione && s.riduzione35Comunicata ? 1 : 0,
    riduzione35DataComunicazione: riduzione && s.riduzione35Comunicata ? s.riduzione35DataComunicazione : null,
    haRedditoDipendente: s.haRedditoDipendente ? 1 : 0,
    limiteForfettario: s.limiteForfettario,
    scadenziarioMetodo: s.scadenziarioMetodo,
    prorogaSaldoAt: s.prorogaSaldoAt,
    primoAnnoFatturatoPrec: s.primoAnnoFatturatoPrec,
    primoAnnoImpostaPrec: s.primoAnnoImpostaPrec,
    primoAnnoAccontiImpostaPrec: s.primoAnnoAccontiImpostaPrec,
    primoAnnoContribVariabiliPrec: s.primoAnnoContribVariabiliPrec,
    primoAnnoAccontiContribPrec: s.primoAnnoAccontiContribPrec,
    tariffaGiornaliera: s.tariffaGiornaliera,
  };
}

export interface AtecoOption { label: string; coefficiente: number }

export function atecoOptions(): AtecoOption[] {
  return atecoGruppiUI().map((g) => ({ label: g.label, coefficiente: g.coefficiente }));
}

export function selectedAtecoIndex(coefficiente: number, opts: AtecoOption[]): number {
  return opts.findIndex((o) => o.coefficiente === coefficiente);
}
