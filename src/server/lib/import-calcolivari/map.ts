import type { z } from 'zod';
import type { ExtractedData, ImportIssue, MappedRows } from './types';
import { det } from './identity';
import { ns, nn, nb, pctToFrac } from './normalize';
import * as S from './schemas';

interface Ctx { profileId: string; userId: string; slug: string }

function yearFromScheduleKey(k?: string | null): number | null {
  if (!k) return null;
  const m = /(\d{4})(?:_\d+)?$/.exec(k);
  return m ? Number(m[1]) : null;
}
function yearFromIso(d?: string | null): number | null {
  if (!d) return null;
  const m = /^(\d{4})/.exec(d);
  return m ? Number(m[1]) : null;
}

function buildAnagrafica(a: Record<string, any>, f: Record<string, any>) {
  return {
    cf: ns(a['codiceFiscale'] ?? f['codiceFiscale']), nome: ns(a['nome'] ?? f['nome']), cognome: ns(a['cognome']),
    sesso: ns(a['sesso']), data_nascita: ns(a['dataNascita']), comune_nascita: ns(a['comuneNascita']), prov_nascita: ns(a['provNascita']),
    residenza: { indirizzo: ns(a['residenzaVia'] ?? f['indirizzo']), cap: ns(a['residenzaCap'] ?? f['cap']), citta: ns(a['residenzaComune'] ?? f['citta']), provincia: ns(a['residenzaProv'] ?? f['provincia']) },
    domicilio_fiscale: { indirizzo: ns(a['domicilioFiscaleVia']), cap: ns(a['domicilioFiscaleCap']), citta: ns(a['domicilioFiscaleComune']), provincia: ns(a['domicilioFiscaleProv']) },
    telefono: ns(a['telefono']), email: ns(a['email']), iban: ns(a['iban'] ?? f['iban']), modalita_pagamento: ns(a['modalitaPagamento'] ?? f['modalitaPagamento']),
  };
}
function buildAttivita(at: Record<string, any>, f: Record<string, any>, regime: string | null) {
  return {
    partita_iva: ns(at['partitaIva'] ?? f['partitaIva']), codice_ateco: ns(at['codiceAteco'] ?? f['ateco']), ateco_gruppo: ns(at['atecoGruppo'] ?? f['atecoGruppo']),
    descrizione_attivita: ns(at['descrizioneAttivita'] ?? f['atecoDescrizione']), comune_domicilio: ns(at['sedeComune']), data_inizio_attivita: ns(at['dataInizioAttivita']),
    regime_default: ns(regime) ?? 'forfettario', agevolazione_startup: nb(at['agevolazioneStartUp'] ?? f['agevolazioneStartUp']), primo_anno_agevolato: nb(at['primoAnnoAgevolato'] ?? f['primoAnnoAgevolato']),
  };
}
function buildOverrides(s: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const k of ['scadenziarioSaldoImposta','scadenziarioAccontoImposta','scadenziarioSaldoContributi','scadenziarioAccontoContributi','scadenziarioDirittoCamerale','scadenziarioBolloPrecedenteQ4','scadenziarioBolloCorrenteQ4','scadenziarioInailCorrente','scadenziarioInailSuccessivo','scadenziarioOverrideDataSaldoImposta']) {
    const v = s[k]; if (v != null && v !== '') o[k] = v;
  }
  return o;
}
function mapRighe(righe: any): any[] {
  return (Array.isArray(righe) ? righe : []).map((r) => ({ descrizione: ns(r?.descrizione), quantita: nn(r?.quantita) ?? 1, prezzo_unitario: nn(r?.prezzoUnitario) ?? 0, iva: nn(r?.iva) ?? 0 }));
}

function validate(schema: z.ZodTypeAny, row: unknown, entity: string, sourceKey: string, issues: ImportIssue[]): boolean {
  const r = schema.safeParse(row);
  if (r.success) return true;
  issues.push({ entity, sourceKey, reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  return false;
}

export function mapAll(ex: ExtractedData, ctx: Ctx): { rows: MappedRows; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const pid = ctx.profileId;

  const profileRow = {
    id: pid, userId: ctx.userId, slug: ctx.slug,
    displayName: ns(ex.displayName) ?? ctx.slug,
    anagrafica: JSON.stringify(buildAnagrafica(ex.anagrafica, ex.fiscal)),
    attivita: JSON.stringify(buildAttivita(ex.attivita, ex.fiscal, ex.regime)),
    giorniIncasso: ex.giorniIncasso,
  };
  const profiles = validate(S.zProfile, profileRow, 'profiles', ctx.slug, issues) ? [profileRow] : [];

  const yearSettings = ex.yearSettings.map((y) => {
    const s = y.settings;
    return {
      profileId: pid, year: y.year, regime: ns(s['regime']) ?? 'forfettario',
      coefficiente: pctToFrac(s['coefficiente']) ?? 0.67, impostaSostitutiva: pctToFrac(s['impostaSostitutiva']) ?? 0.15,
      inpsMode: ns(s['inpsMode']) ?? 'gestione_separata', inpsCategoria: ns(s['inpsCategoria']),
      riduzione35: nb(s['riduzione35']), haRedditoDipendente: nb(s['haRedditoDipendente']),
      limiteForfettario: nn(s['limiteForfettario']) ?? 85000, scadenziarioMetodo: ns(s['scadenziarioMetodoAcconti']) ?? 'storico',
      primoAnnoFatturatoPrec: nn(s['primoAnnoFatturatoPrec']), primoAnnoImpostaPrec: nn(s['primoAnnoImpostaPrec']),
      primoAnnoAccontiImpostaPrec: nn(s['primoAnnoAccontiImpostaPrec']), primoAnnoContribVariabiliPrec: nn(s['primoAnnoContribVariabiliPrec']),
      primoAnnoAccontiContribPrec: nn(s['primoAnnoAccontiContribPrec']), overrides: JSON.stringify(buildOverrides(s)),
    };
  }).filter((r) => validate(S.zYearSettings, r, 'yearSettings', `year ${r.year}`, issues));

  const clienti = ex.clienti.map((c) => ({
    id: ns(c['id']) ?? det('cliente', pid, c['nome'], c['partitaIva'], c['codiceFiscale']), profileId: pid,
    nome: ns(c['nome']) ?? '(senza nome)', tipoCliente: ns(c['tipoCliente']) ?? 'PG',
    partitaIva: ns(c['partitaIva']), codiceFiscale: ns(c['codiceFiscale']), codiceSdi: ns(c['codiceSDI']) ?? '0000000',
    pec: ns(c['pec']), indirizzo: ns(c['indirizzo']), cap: ns(c['cap']), citta: ns(c['citta']), provincia: ns(c['provincia']), nazione: ns(c['nazione']) ?? 'IT',
    descrizioneStandard: ns(c['descrizioneStandard']), isDefault: c['id'] && c['id'] === ex.clienteDefaultId ? 1 : 0, note: ns(c['note']),
  })).filter((r) => validate(S.zCliente, r, 'clienti', String(r.id), issues));

  const fatture = ex.fatture.map((f) => {
    const anno = nn(f['annoProgressivo'] ?? f['anno']) ?? 0;
    const prog = nn(f['progressivo']) ?? 0;
    return {
      id: ns(f['id']) ?? det('fattura', pid, anno, prog), profileId: pid, clienteId: ns(f['clienteId']),
      tipoDocumento: ns(f['tipoDocumento']) ?? 'TD01', annoProgressivo: anno, progressivo: prog, numeroDisplay: `${anno}/${prog}`,
      data: ns(f['data']) ?? `${anno || 1970}-${String(nn(f['pagMese']) ?? 1).padStart(2, '0')}-01`,
      clienteSnapshot: f['clienteSnapshot'] ? JSON.stringify(f['clienteSnapshot']) : null, righe: JSON.stringify(mapRighe(f['righe'])),
      importo: nn(f['totaleLordo'] ?? f['totaleDocument'] ?? f['totaleDocumento'] ?? f['importo']) ?? 0,
      ritenuta: nn(f['ritenuta']) ?? 0, aliquotaRitenuta: nn(f['aliquotaRitenuta']), tipoRitenuta: ns(f['tipoRitenuta']), causaleRitenuta: ns(f['causaleRitenuta']),
      contributoIntegrativo: nn(f['contributoIntegrativo']) ?? 0, marcaDaBollo: nb(f['marcaDaBollo']), bolloAddebitato: nb(f['bolloAddebitato']),
      stato: ns(f['stato']) ?? 'bozza', dataInvioSdi: ns(f['dataInvioSdi']), dataPagamento: ns(f['dataPagamento']), pagMese: nn(f['pagMese']), pagAnno: nn(f['pagAnno']),
      modalitaPagamento: ns(f['modalitaPagamento']), fatturaOriginaleId: ns(f['fatturaOriginaleId']), tipoStorno: ns(f['tipoStorno']),
      ncTotaleImporto: nn(f['ncTotaleImporto']) ?? 0, ncIds: f['ncIds'] ? JSON.stringify(f['ncIds']) : null, origine: ns(f['origine']) ?? 'manuale', note: ns(f['note']),
    };
  }).filter((r) => validate(S.zFattura, r, 'fatture', r.numeroDisplay, issues));

  // Note: pagamenti are NOT given fallback defaults for data/tipo/importo so that genuinely
  // invalid raw values (e.g. empty string, non-numeric importo) fail Zod and become ImportIssues.
  const rawPagamenti = ex.pagamenti.map((p) => ({
    id: det('pagamento', pid, p['data'], p['importo'], p['tipo'], p['descrizione'], p['scheduleKey']), profileId: pid,
    year: yearFromScheduleKey(p['scheduleKey'] as string | null) ?? yearFromIso(p['data'] as string | null) ?? p.year,
    data: ns(p['data']), tipo: ns(p['tipo']), descrizione: ns(p['descrizione']), importo: nn(p['importo']),
    scheduleKey: ns(p['scheduleKey']), linkedKeys: null, note: null,
  }));
  const pagamenti = rawPagamenti.filter((r) => validate(S.zPagamento, r, 'pagamenti', `${String(r.data)}/${String(r.importo)}`, issues)) as MappedRows['pagamenti'];

  const calendarEntries = ex.calendar.map((c) => ({ profileId: pid, year: c.year, month: c.month, day: c.day, activityCode: c.code }))
    .filter((r) => validate(S.zCalendar, r, 'calendarEntries', `${r.year}-${r.month}-${r.day}`, issues));

  const budgetItems = ex.budget.map((b) => ({ id: det('budget', pid, b.year, b.nome, b.importo), profileId: pid, year: b.year, nome: ns(b.nome) ?? '(voce)', importo: nn(b.importo) ?? 0, auto: nb(b.auto), ordine: b.ordine }))
    .filter((r) => validate(S.zBudget, r, 'budgetItems', `${r.year}/${r.nome}`, issues));

  const spese = ex.spese.map((s) => ({ id: det('spesa', pid, s.year, s['titolo'], s['costo'], s['deducibilita'], s['anni']), profileId: pid, year: s.year, titolo: ns(s['titolo']) ?? '(spesa)', costo: nn(s['costo']) ?? 0, deducibilita: nn(s['deducibilita']) ?? 1, anni: nn(s['anni']) ?? 1, categoria: ns(s['categoria']) }))
    .filter((r) => validate(S.zSpesa, r, 'spese', `${r.year}/${r.titolo}`, issues));

  const dichiarazioni = ex.dichiarazioni.map(({ year, dichiarazione: d }) => ({
    profileId: pid, year, tipo: ns(d['tipoDichiarazione']) ?? 'ordinaria',
    flags: d['flags'] ? JSON.stringify(d['flags']) : null, contiEsteri: d['contiEsteri'] ? JSON.stringify(d['contiEsteri']) : null,
    overrides: JSON.stringify({ ...(d['overrides'] ?? {}), ...(d['coniuge'] ? { _coniuge: d['coniuge'] } : {}), ...(d['familiariCarico'] ? { _familiariCarico: d['familiariCarico'] } : {}) }),
    statoCompilazione: d['statoCompilazione'] ? JSON.stringify({ legacy: d['statoCompilazione'] }) : null, confirmedWarnings: null,
  })).filter((r) => validate(S.zDichiarazione, r, 'dichiarazioni', `year ${r.year}`, issues));

  return { rows: { profiles, yearSettings, clienti, fatture, pagamenti, calendarEntries, budgetItems, spese, dichiarazioni }, issues };
}
