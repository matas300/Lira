// src/client/lib/profile-form.ts
// Logica pura dell'editor di profilo (anagrafica/attività): defaults, mapping
// stato↔body, validatori di formato. Nessun DOM, nessun fetch. Condiviso fra
// pages/profilo-personale.ts e pages/profilo-piva.ts.

import { isValidPartitaIvaIT, isValidCodiceFiscale, isValidPec } from '@shared/validators';

export interface Indirizzo { indirizzo: string; cap: string; citta: string; provincia: string }

export interface AnagraficaState {
  cf: string; nome: string; cognome: string; sesso: string;
  data_nascita: string; comune_nascita: string; prov_nascita: string;
  residenza: Indirizzo; domicilio_fiscale: Indirizzo;
  telefono: string; email: string; iban: string; modalita_pagamento: string;
}

export interface AttivitaState {
  partita_iva: string; codice_ateco: string; ateco_gruppo: string;
  descrizione_attivita: string; comune_domicilio: string; data_inizio_attivita: string;
}

function s(v: unknown): string { return v == null ? '' : String(v); }
function indirizzo(v: unknown): Indirizzo {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { indirizzo: s(o['indirizzo']), cap: s(o['cap']), citta: s(o['citta']), provincia: s(o['provincia']) };
}

export function anagraficaDefaults(): AnagraficaState {
  return {
    cf: '', nome: '', cognome: '', sesso: '', data_nascita: '', comune_nascita: '', prov_nascita: '',
    residenza: { indirizzo: '', cap: '', citta: '', provincia: '' },
    domicilio_fiscale: { indirizzo: '', cap: '', citta: '', provincia: '' },
    telefono: '', email: '', iban: '', modalita_pagamento: '',
  };
}

export function attivitaDefaults(): AttivitaState {
  return {
    partita_iva: '', codice_ateco: '', ateco_gruppo: '', descrizione_attivita: '',
    comune_domicilio: '', data_inizio_attivita: '',
  };
}

export function anagraficaFromResponse(a: Record<string, unknown>): AnagraficaState {
  return {
    cf: s(a['cf']), nome: s(a['nome']), cognome: s(a['cognome']), sesso: s(a['sesso']),
    data_nascita: s(a['data_nascita']), comune_nascita: s(a['comune_nascita']), prov_nascita: s(a['prov_nascita']),
    residenza: indirizzo(a['residenza']), domicilio_fiscale: indirizzo(a['domicilio_fiscale']),
    telefono: s(a['telefono']), email: s(a['email']), iban: s(a['iban']), modalita_pagamento: s(a['modalita_pagamento']),
  };
}

export function attivitaFromResponse(a: Record<string, unknown>): AttivitaState {
  return {
    partita_iva: s(a['partita_iva']), codice_ateco: s(a['codice_ateco']), ateco_gruppo: s(a['ateco_gruppo']),
    descrizione_attivita: s(a['descrizione_attivita']), comune_domicilio: s(a['comune_domicilio']),
    data_inizio_attivita: s(a['data_inizio_attivita']),
  };
}

export function anagraficaToBody(st: AnagraficaState): Record<string, unknown> {
  return { ...st, residenza: { ...st.residenza }, domicilio_fiscale: { ...st.domicilio_fiscale } };
}

export function attivitaToBody(st: AttivitaState): Record<string, unknown> {
  return { ...st };
}

export function copyResidenzaToDomicilio(st: AnagraficaState): AnagraficaState {
  return { ...st, domicilio_fiscale: { ...st.residenza } };
}

// ── validatori di formato (vuoto = OK, postura permissiva) ──
export type FieldKind = 'partita_iva' | 'cf' | 'cap' | 'provincia' | 'email';

export function fieldError(kind: FieldKind, value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  switch (kind) {
    case 'partita_iva': return isValidPartitaIvaIT(v.replace(/\s+/g, '')) ? null : 'P.IVA non valida (11 cifre).';
    // Fix M4: validazione completa col carattere di controllo (un CF con
    // check-char errato causa lo scarto della fattura da SdI).
    case 'cf': return isValidCodiceFiscale(v.toUpperCase()) ? null : 'Codice fiscale non valido (verifica il carattere di controllo).';
    case 'cap': return /^\d{5}$/.test(v) ? null : 'CAP non valido (5 cifre).';
    case 'provincia': return /^[A-Za-z]{2}$/.test(v) ? null : 'Provincia: 2 lettere.';
    case 'email': return isValidPec(v) ? null : 'Email non valida.';
  }
}
