// src/client/lib/budget-calc.ts
//
// Calcoli puri del Budget (no DOM, no fetch). Port da CalcoliVari app-budget.js:
//  - monthsWithFatture: lordo per mese delle fatture pagate nell'anno (NC negative).
//  - computeNettoMensile: netto mensile di riferimento (manuale/auto/media).
//  - computeAllocation: ripartizione delle voci sul netto mensile (+ auto-split).

export interface BudgetFattura {
  importo: number;
  ritenuta?: number | null;
  pagAnno?: number | null;
  pagMese?: number | null;
  stato?: string | null;
  tipoDocumento?: string | null;
}

export interface MonthLordo {
  month: number;
  lordo: number;
}

export interface BudgetItemData {
  nome: string;
  importo: number;
  auto: boolean;
  ordine: number;
}

export interface NettoMensile {
  netto: number;
  lordo: number;
  rate: number;
  month: number | null;
  source: 'manual' | 'auto' | 'media';
}

export interface AllocRow {
  nome: string;
  val: number;
  isAuto: boolean;
  pct: number;
}

export interface Allocation {
  rows: AllocRow[];
  totBudget: number;
  rimanente: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Arrotonda per eccesso a 2 decimali (per la conversione % → importo). */
export function ceil2(n: number): number {
  return Math.ceil((n - Number.EPSILON) * 100) / 100;
}

/**
 * Lordo per mese delle fatture pagate nell'anno (`pagAnno === year`).
 * NC (TD04) sottraggono; le bozze sono escluse; mostra solo mesi con totale > 0.
 */
export function monthsWithFatture(fatture: BudgetFattura[], year: number): MonthLordo[] {
  const byMonth = new Map<number, number>();
  for (const f of fatture) {
    if (f.pagAnno !== year) continue;
    if (f.stato === 'bozza') continue;
    const m = f.pagMese;
    if (m == null || m < 1 || m > 12) continue;
    let val = (Number(f.importo) || 0) - (Number(f.ritenuta) || 0);
    if (f.tipoDocumento === 'TD04') val = -val;
    byMonth.set(m, (byMonth.get(m) ?? 0) + val);
  }
  const out: MonthLordo[] = [];
  for (const [month, lordo] of byMonth) {
    if (lordo > 0) out.push({ month, lordo: round2(lordo) });
  }
  out.sort((a, b) => a.month - b.month);
  return out;
}

/**
 * Netto mensile di riferimento.
 *  - baseMonth valorizzato e presente → 'manual'
 *  - altrimenti, se ci sono mesi → 'auto' (ultimo mese disponibile)
 *  - altrimenti → 'media' (nettoAnnuo / 12)
 */
export function computeNettoMensile(args: {
  baseMonth: number | null;
  months: MonthLordo[];
  rate: number;
  nettoAnnuo: number;
}): NettoMensile {
  const rate = Number.isFinite(args.rate) ? args.rate : 0;
  const { baseMonth, months, nettoAnnuo } = args;

  if (baseMonth != null) {
    const found = months.find((m) => m.month === baseMonth);
    if (found) {
      return { netto: round2(found.lordo * (1 - rate)), lordo: found.lordo, rate, month: baseMonth, source: 'manual' };
    }
  }
  if (months.length > 0) {
    const latest = months[months.length - 1]!; // ordinati asc → ultimo = più recente
    return { netto: round2(latest.lordo * (1 - rate)), lordo: latest.lordo, rate, month: latest.month, source: 'auto' };
  }
  return { netto: round2((Number(nettoAnnuo) || 0) / 12), lordo: 0, rate, month: null, source: 'media' };
}

/**
 * Ripartizione delle voci sul netto mensile. Le voci `auto` senza importo
 * manuale (> 0) si dividono equamente il rimanente positivo.
 */
export function computeAllocation(items: BudgetItemData[], nettoMensile: number): Allocation {
  let totManual = 0;
  let autoCount = 0;
  for (const b of items) {
    if (b.auto && !(Number(b.importo) > 0)) autoCount++;
    else totManual += Number(b.importo) || 0;
  }
  const autoAmount = autoCount > 0 && nettoMensile > totManual
    ? (nettoMensile - totManual) / autoCount
    : 0;

  const rows: AllocRow[] = items.map((b) => {
    const isAuto = b.auto && !(Number(b.importo) > 0);
    const val = isAuto ? autoAmount : (Number(b.importo) || 0);
    const pct = nettoMensile > 0 ? (val / nettoMensile) * 100 : 0;
    return { nome: b.nome, val: round2(val), isAuto, pct: round2(pct) };
  });
  const totBudget = round2(rows.reduce((s, r) => s + r.val, 0));
  const rimanente = round2(nettoMensile - totBudget);
  return { rows, totBudget, rimanente };
}
