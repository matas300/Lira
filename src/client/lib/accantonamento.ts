// src/client/lib/accantonamento.ts
//
// Calcolo puro "Tasse Accantonate vs Versate".
// Riceve le fatture (tutte del profilo), i pagamenti dell'anno e il tasso
// effettivo (imposta+INPS / lordo) già calcolato dal backend. Ritorna:
//   - rows: fatture incassate nell'anno, con imponibile e da-accantonare
//   - totals: lordo, daAccantonare, versato, gap
//   - cumulative: serie mese 1..12 (maturato / versato CUMULATI)
//   - deferred: fatture emesse nell'anno ma non ancora incassate nell'anno
//
// PURO: nessun DOM, nessun fetch, nessun side-effect.

export interface AccFattura {
  importo: number;
  ritenuta?: number | null;
  data: string;           // ISO date (YYYY-MM-DD)
  annoProgressivo?: number | null;
  pagAnno?: number | null;
  pagMese?: number | null;
  clienteSnapshot?: string | null;
  numeroDisplay?: string | null;
}

export interface AccPagamento {
  data: string;           // ISO date
  importo: number;
  tipo?: string | null;
}

export interface AccRow {
  label: string;
  mese: number;           // 1..12
  lordo: number;          // imponibile (importo − ritenuta)
  daAccantonare: number;  // lordo × effectiveRate, arrotondato a 2 decimali
}

export interface AccCumPoint {
  month: number;          // 1..12
  maturato: number;       // somma daAccantonare per mese ≤ month (cumulata)
  versato: number;        // somma pagamenti per mese ≤ month (cumulata)
}

export interface AccDeferred {
  label: string;
  importo: number;
  annoIncasso: number | null;   // null = non ancora incassata
}

export interface AccResult {
  rows: AccRow[];
  totals: { lordo: number; daAccantonare: number; versato: number; gap: number };
  cumulative: AccCumPoint[];   // length 12
  deferred: AccDeferred[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Estrae il mese (1..12) da una stringa ISO date "YYYY-MM-DD". */
function monthFromDate(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1;
}

/** Ricava il nome cliente da clienteSnapshot (JSON string) o da numeroDisplay. */
function labelFromFattura(f: AccFattura): string {
  if (f.clienteSnapshot) {
    try {
      const snap = JSON.parse(f.clienteSnapshot) as Record<string, unknown>;
      const nome =
        (snap['nome'] as string | undefined) ??
        (snap['cessionarioRagione'] as string | undefined) ??
        (snap['ragioneSociale'] as string | undefined);
      if (nome) return String(nome);
    } catch {
      // parse fallito → fallthrough
    }
  }
  if (f.numeroDisplay) return String(f.numeroDisplay);
  return '—';
}

// ── Funzione principale ───────────────────────────────────────────────────────

export function computeAccantonamento(args: {
  fatture: AccFattura[];
  pagamenti: AccPagamento[];
  year: number;
  effectiveRate: number;
}): AccResult {
  const { fatture, pagamenti, year, effectiveRate } = args;
  // Clamp rate per sicurezza (evita NaN se fosse non-finite)
  const rate = Number.isFinite(effectiveRate) ? effectiveRate : 0;

  // ── rows: fatture incassate nell'anno ────────────────────────────────────
  const rows: AccRow[] = [];
  for (const f of fatture) {
    if (f.pagAnno !== year) continue;
    const lordo = (Number(f.importo) || 0) - (Number(f.ritenuta) || 0);
    const mese = f.pagMese != null && f.pagMese >= 1 && f.pagMese <= 12
      ? f.pagMese
      : monthFromDate(f.data);
    rows.push({
      label: labelFromFattura(f),
      mese,
      lordo: round2(Math.max(0, lordo)),
      daAccantonare: round2(Math.max(0, lordo) * rate),
    });
  }

  // Ordina per mese
  rows.sort((a, b) => a.mese - b.mese);

  // ── totals ───────────────────────────────────────────────────────────────
  const totaleLordo = round2(rows.reduce((s, r) => s + r.lordo, 0));
  const totaleDaAccantonare = round2(rows.reduce((s, r) => s + r.daAccantonare, 0));
  const totaleVersato = round2(pagamenti.reduce((s, p) => s + (Number(p.importo) || 0), 0));
  const gap = round2(totaleDaAccantonare - totaleVersato);

  // ── cumulative ───────────────────────────────────────────────────────────
  const cumulative: AccCumPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const maturato = round2(rows
      .filter((r) => r.mese <= m)
      .reduce((s, r) => s + r.daAccantonare, 0));
    const versato = round2(pagamenti
      .filter((p) => monthFromDate(p.data) <= m)
      .reduce((s, p) => s + (Number(p.importo) || 0), 0));
    cumulative.push({ month: m, maturato, versato });
  }

  // ── deferred: emesse nell'anno ma pagAnno !== year ───────────────────────
  const deferred: AccDeferred[] = [];
  for (const f of fatture) {
    const annoEmissione = Number(f.data.slice(0, 4));
    if (annoEmissione !== year) continue;   // non emessa quest'anno
    if (f.pagAnno === year) continue;       // già incassata nell'anno → rows
    deferred.push({
      label: labelFromFattura(f),
      importo: Number(f.importo) || 0,
      annoIncasso: f.pagAnno != null ? Number(f.pagAnno) : null,
    });
  }

  return { rows, totals: { lordo: totaleLordo, daAccantonare: totaleDaAccantonare, versato: totaleVersato, gap }, cumulative, deferred };
}
