// src/shared/ricavi-cassa.ts
//
// Single source of truth per i "ricavi di cassa" del forfettario (principio di
// cassa, art. 1 c. 64 L. 190/2014). Prima ogni pagina/route sommava i ricavi a
// modo suo: alcuni siti sommavano le note di credito (TD04) invece di
// sottrarle, altri escludevano le bozze e altri no, e le fatture incassate ma
// con `pag_anno` nullo (tipico dei dati importati) sparivano dai ricavi
// (reddito SOTTOSTIMATO → rischio accertamento). Questo modulo centralizza le
// regole così che server (scenario-data, scadenziario-service, storico-base) e
// client (budget, accantonamento) calcolino lo stesso numero.
//
// Regole:
//  - **Anno di incasso** = `pagAnno` se valorizzato; altrimenti, se la fattura
//    NON è una bozza, l'anno di `dataPagamento` (recupero dei dati importati
//    senza `pag_anno`). Le bozze non sono mai incassate.
//  - **Segno** = −1 per le note di credito (TD04), +1 altrimenti: la NC storna
//    corrispettivi (art. 26 DPR 633/1972), non li aumenta.
//  - **Importo** = `importo − ritenuta`. Per il forfettario la ritenuta è
//    sempre 0 (art. 1 c. 67 L. 190/2014) — enforce all'import — quindi coincide
//    col lordo percepito; il termine `− ritenuta` resta solo per robustezza sui
//    dati legacy.

export interface RicavoFattura {
  importo: number;
  ritenuta?: number | null;
  pagAnno?: number | null;
  pagMese?: number | null;
  stato?: string | null;
  tipoDocumento?: string | null;
  /** ISO `YYYY-MM-DD`. Usata per dedurre anno/mese di incasso se `pag_anno`/`pag_mese` mancano. */
  dataPagamento?: string | null;
  /** ISO `YYYY-MM-DD` data documento — fallback ultimo per il mese. */
  data?: string | null;
}

/** `true` se la fattura è una bozza (mai incassata). */
export function isBozza(f: RicavoFattura): boolean {
  return f.stato === 'bozza';
}

function yearFromIso(iso: string | null | undefined): number | null {
  if (!iso || iso.length < 4) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

function monthFromIso(iso: string | null | undefined): number | null {
  if (!iso || iso.length < 7) return null;
  const m = Number(iso.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : null;
}

/**
 * Anno di incasso della fattura secondo il principio di cassa, oppure `null`
 * se non determinabile (bozza, oppure incassata senza `pag_anno` né
 * `dataPagamento` → va segnalata, non silenziosamente attribuita).
 */
export function annoIncassoOf(f: RicavoFattura): number | null {
  if (isBozza(f)) return null;
  if (f.pagAnno != null) return f.pagAnno;
  return yearFromIso(f.dataPagamento);
}

/**
 * Mese di incasso (1-12) o `null`: `pag_mese`, altrimenti mese di
 * `dataPagamento`, altrimenti mese di `data`.
 */
export function meseIncassoOf(f: RicavoFattura): number | null {
  if (f.pagMese != null && f.pagMese >= 1 && f.pagMese <= 12) return f.pagMese;
  return monthFromIso(f.dataPagamento) ?? monthFromIso(f.data);
}

/**
 * Importo di cassa con segno: `(importo − ritenuta)` moltiplicato per −1 se
 * nota di credito (TD04). È la quantità da sommare ai ricavi dell'anno.
 */
export function importoRicavoCassa(f: RicavoFattura): number {
  const netto = (Number(f.importo) || 0) - (Number(f.ritenuta) || 0);
  return f.tipoDocumento === 'TD04' ? -netto : netto;
}

/**
 * `true` se la fattura risulta INCASSATA (non bozza) ma senza un anno di
 * incasso determinabile (`pag_anno` e `dataPagamento` entrambi assenti): il suo
 * ricavo NON viene conteggiato in alcun anno e va segnalato all'utente.
 */
export function isIncassoSenzaAnno(f: RicavoFattura): boolean {
  // `stato === 'pagata'` è l'unico stato "incassato" dell'enum (bozza/inviata/
  // pagata/stornata): il ramo 'incassata' era morto (fix re-audit #18).
  return !isBozza(f) && f.pagAnno == null && yearFromIso(f.dataPagamento) == null
    && (Number(f.importo) || 0) !== 0 && f.stato === 'pagata';
}

/** Somma dei ricavi di cassa incassati nell'anno `year` (NC sottratte, bozze escluse). */
export function sommaRicaviCassa(fatture: readonly RicavoFattura[], year: number): number {
  let total = 0;
  for (const f of fatture) {
    if (annoIncassoOf(f) !== year) continue;
    total += importoRicavoCassa(f);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Breakdown mensile dei ricavi di cassa dell'anno. `onlyPositive` filtra i mesi
 * con totale ≤ 0 (usato dal Budget); di default ritorna tutti i mesi con
 * movimenti, ordinati.
 */
export function ricaviCassaPerMese(
  fatture: readonly RicavoFattura[],
  year: number,
  opts: { onlyPositive?: boolean } = {},
): { month: number; lordo: number }[] {
  const byMonth = new Map<number, number>();
  for (const f of fatture) {
    if (annoIncassoOf(f) !== year) continue;
    const m = meseIncassoOf(f);
    if (m == null) continue;
    byMonth.set(m, (byMonth.get(m) ?? 0) + importoRicavoCassa(f));
  }
  const out: { month: number; lordo: number }[] = [];
  for (const [month, lordo] of byMonth) {
    const r = Math.round(lordo * 100) / 100;
    if (opts.onlyPositive && r <= 0) continue;
    out.push({ month, lordo: r });
  }
  out.sort((a, b) => a.month - b.month);
  return out;
}
