// src/shared/cedente.ts
//
// Lettura tipizzata del cedente/prestatore dai JSON di profilo Lira
// (profiles.anagrafica + profiles.attivita) + regime (year_settings).
// Fail-fast: nessun XML con cedente incompleto (audit A2).

import { isValidPartitaIvaIT } from './validators';

export interface Cedente {
  partitaIva: string;
  codiceFiscale: string;
  nome: string;
  cognome: string;
  indirizzo: string;
  cap: string;
  comune: string;
  provincia: string;
  nazione: string;
  regime: 'forfettario' | 'ordinario';
}

interface ProfileParts {
  anagrafica: unknown;
  attivita: unknown;
  regime: string;
}

function s(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export function readCedenteFromProfile(p: ProfileParts): { cedente: Cedente } | { errors: string[] } {
  const a = (p.anagrafica && typeof p.anagrafica === 'object' ? p.anagrafica : {}) as Record<string, unknown>;
  const att = (p.attivita && typeof p.attivita === 'object' ? p.attivita : {}) as Record<string, unknown>;
  const res = (a.residenza && typeof a.residenza === 'object' ? a.residenza : {}) as Record<string, unknown>;

  const cedente: Cedente = {
    partitaIva: s(att.partita_iva).replace(/\s+/g, ''),
    codiceFiscale: s(a.cf).toUpperCase(),
    nome: s(a.nome),
    cognome: s(a.cognome),
    indirizzo: s(res.indirizzo),
    cap: s(res.cap),
    comune: s(res.citta),
    provincia: s(res.provincia).toUpperCase().slice(0, 2),
    nazione: 'IT',
    regime: p.regime === 'ordinario' ? 'ordinario' : 'forfettario',
  };

  const errors: string[] = [];
  if (!isValidPartitaIvaIT(cedente.partitaIva)) {
    errors.push('P.IVA del cedente mancante o non valida (11 cifre, check-digit) - completa l\'anagrafica di profilo.');
  }
  if (!cedente.indirizzo) errors.push('Indirizzo del cedente mancante nell\'anagrafica di profilo.');
  if (!/^\d{5}$/.test(cedente.cap)) errors.push('CAP del cedente mancante o non valido (5 cifre).');
  if (!cedente.comune) errors.push('Comune del cedente mancante nell\'anagrafica di profilo.');
  if (!/^[A-Z]{2}$/.test(cedente.provincia)) errors.push('Provincia del cedente mancante o non valida (2 lettere).');
  if (!cedente.nome && !cedente.cognome) errors.push('Nome/Cognome (o denominazione) del cedente mancanti.');

  return errors.length ? { errors } : { cedente };
}
