// src/server/lib/piva-lookup.ts
//
// Lookup anagrafica cliente da P.IVA via company.openapi.com (IT-start).
// Porta normalizeResponse/pickAddress da CalcoliVari/clienti-autofill.js.
// `fetchImpl` iniettabile → testabile senza rete. NESSUNA key hardcoded:
// la key arriva dal chiamante (route legge process.env.OPENAPI_COMPANY_KEY).

import type { PivaLookupData, PivaLookupResult } from '@shared/types';

type LookupCode = 'INVALID_PIVA' | 'NO_KEY' | 'NOT_FOUND' | 'NETWORK';

/** Timeout della chiamata all'upstream openapi.com (ms). */
const PIVA_LOOKUP_TIMEOUT_MS = 5000;

interface LookupOpts {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function s(v: unknown): string {
  return (v == null ? '' : String(v)).trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickAddress(d: any): { street: string; zip: string; city: string; province: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addr: any = d.address || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg: any = addr.registeredOffice || addr.registered_office || (d.address ? addr : d);
  let full = s(reg.streetName);
  if (!full) {
    const base = s(reg.street || reg.toponimo || reg.via || reg.indirizzo);
    const num = s(reg.streetNumber || reg.street_number || reg.civico);
    full = base + (base && num ? ' ' + num : '');
  }
  return {
    street: full,
    zip: s(reg.zipCode || reg.zip_code || reg.zip || reg.cap),
    city: s(reg.town || reg.city || reg.comune || reg.citta),
    province: s(reg.province || reg.provincia).toUpperCase(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeResponse(raw: any): PivaLookupData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = raw || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let d: any = payload.data;
  if (Array.isArray(d)) d = d[0] || {};
  else if (!d || typeof d !== 'object') d = payload;
  const a = pickAddress(d);
  const out: PivaLookupData = {};
  const nome = s(d.companyName || d.denominazione || d.ragione_sociale || d.nome);
  const cf = s(d.taxCode || d.codice_fiscale || d.cf).toUpperCase();
  const pec = s(d.pec || d.email_pec);
  const sdi = s(d.sdiCode || d.codice_sdi).toUpperCase();
  if (nome) out.nome = nome;
  if (cf) out.codiceFiscale = cf;
  if (a.street) out.indirizzo = a.street;
  if (a.zip) out.cap = a.zip;
  if (a.city) out.citta = a.city;
  if (a.province) out.provincia = a.province;
  if (pec) out.pec = pec;
  if (sdi) out.codiceSdi = sdi;
  return out;
}

function fail(code: LookupCode): PivaLookupResult {
  return { ok: false, code };
}

export async function lookupPartitaIva(piva: string, opts: LookupOpts): Promise<PivaLookupResult> {
  const clean = (piva || '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(clean)) return fail('INVALID_PIVA');
  if (!opts.apiKey) return fail('NO_KEY');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return fail('NETWORK');
  try {
    // Timeout esplicito: l'upstream esterno non deve poter bloccare a tempo
    // indefinito uno slot di richiesta sulla VM Fly da 512MB. AbortSignal.timeout
    // fa rigettare la fetch (→ catch → NETWORK) dopo PIVA_LOOKUP_TIMEOUT_MS.
    const res = await fetchImpl(`https://company.openapi.com/IT-start/${clean}`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: AbortSignal.timeout(PIVA_LOOKUP_TIMEOUT_MS),
    });
    if (res.status === 404) return fail('NOT_FOUND');
    if (!res.ok) return fail('NETWORK');
    const json = await res.json();
    return { ok: true, data: normalizeResponse(json) };
  } catch {
    // Include AbortError/TimeoutError da AbortSignal.timeout.
    return fail('NETWORK');
  }
}
