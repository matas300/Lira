import type { RawExport, YearDoc, ExtractedData } from './types';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yearDocs(keys: Record<string, unknown>, profile: string): YearDoc[] {
  const re = new RegExp(`^calcoliPIVA_${escapeRe(profile)}_(\\d{4})$`);
  const docs: YearDoc[] = [];
  for (const [k, v] of Object.entries(keys)) {
    const m = re.exec(k);
    if (m && v && typeof v === 'object') docs.push({ year: Number(m[1]!), data: v as Record<string, any> });
  }
  return docs.sort((a, b) => a.year - b.year);
}

function keyFor(keys: Record<string, unknown>, profile: string, suffix: string): unknown {
  return keys[`calcoliPIVA_${profile}_${suffix}`];
}

function mergeFirstNonEmpty(objs: Array<Record<string, any> | null | undefined>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o)) {
      if ((out[k] == null || out[k] === '') && v != null && String(v).trim() !== '') out[k] = v;
    }
  }
  return out;
}

export function extractAll(exp: RawExport): ExtractedData {
  const { profileName: p, keys } = exp;
  const docs = yearDocs(keys, p);
  const fiscal = (keys[`calcoliPIVA_profile_${p}`] as Record<string, any>) ?? {};

  const anagrafica = mergeFirstNonEmpty(docs.map((d) => d.data?.settings?.anagrafica));
  const attivita = mergeFirstNonEmpty(docs.map((d) => d.data?.settings?.attivita));
  const regime = mergeFirstNonEmpty(docs.map((d) => d.data?.settings)).regime ?? null;
  const displayName = (fiscal.nome as string) ?? ([anagrafica.nome, anagrafica.cognome].filter(Boolean).join(' ') || null);

  const clienti = (keyFor(keys, p, 'clienti') as any[]) ?? [];
  const clienteDefaultId = (keyFor(keys, p, 'clienteDefaultId') as string) ?? null;
  const giorniIncasso = Number(keyFor(keys, p, 'giorniIncasso') ?? 30) || 30;

  const canon = ((keyFor(keys, p, 'fattureEmesse') as any[]) ?? []).map((f) => ({ ...f }));
  const legacy: Array<Record<string, any>> = [];
  for (const doc of docs) {
    // _fattureManualeWipedBackup = invoice genuinamente wipate (recupera sempre).
    // doc.data.fatture = vecchia struttura pre-migrazione: è un mirror di ciò che
    // ora sta in fattureEmesse, quindi va usata SOLO se il profilo non ha canon
    // (mai migrato a fattureEmesse), altrimenti duplicheremmo le fatture canoniche.
    const wiped = doc.data?._fattureManualeWipedBackup ?? (canon.length === 0 ? doc.data?.fatture : undefined) ?? {};
    let idx = 0;
    for (const arr of Object.values(wiped)) {
      for (const row of (Array.isArray(arr) ? arr : [])) {
        if (row && typeof row === 'object' && !(row as any).invoiceId) {
          const importo = (row as any).importo;
          legacy.push({
            origine: 'legacy-migrated',
            stato: 'bozza',
            annoProgressivo: doc.year,
            progressivo: 9000 + idx++,
            importo,
            pagMese: (row as any).pagMese ?? null,
            pagAnno: (row as any).pagAnno ?? null,
            righe: [{ descrizione: (row as any).desc ?? 'legacy', quantita: 1, prezzoUnitario: importo, iva: 0 }],
          });
        }
      }
    }
  }

  const pagamenti = docs.flatMap((d) => ((d.data?.pagamenti as any[]) ?? []).map((pg) => ({ ...pg, year: d.year })));

  const calendar = docs.flatMap((d) =>
    Object.entries((d.data?.calendar as Record<string, string>) ?? {})
      .filter(([, code]) => code && String(code).trim() !== '')
      .map(([md, code]) => {
        const parts = md.split('-');
        return { year: d.year, month: Number(parts[0]), day: Number(parts[1]), code: String(code) };
      }),
  );

  const budget = docs.flatMap((d) =>
    ((d.data?.budget as any[]) ?? []).map((b, i) => ({ year: d.year, nome: b?.nome, importo: b?.importo, auto: b?.auto, ordine: i })),
  );

  const spese = docs.flatMap((d) => ((d.data?.spese as any[]) ?? []).map((s) => ({ ...s, year: d.year })));

  const dichiarazioni = docs
    .map((d) => {
      const dich = d.data?.dichiarazione ?? (d.data?.lmQuadro ? { overrides: d.data.lmQuadro.overrides ?? {} } : null);
      return dich ? { year: d.year, dichiarazione: dich as Record<string, any> } : null;
    })
    .filter((x): x is { year: number; dichiarazione: Record<string, any> } => x != null);

  const yearSettings = docs.map((d) => ({ year: d.year, settings: (d.data?.settings as Record<string, any>) ?? {} }));

  return {
    profileName: p, anagrafica, attivita, fiscal, regime, displayName, giorniIncasso,
    yearSettings, clienti, clienteDefaultId,
    fatture: [...canon, ...legacy], pagamenti, calendar, budget, spese, dichiarazioni,
  };
}
