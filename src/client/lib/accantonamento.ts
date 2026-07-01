// src/client/lib/accantonamento.ts
//
// Calcolo puro "Tasse Accantonate vs Versate".
// Riceve le fatture (tutte del profilo), i pagamenti dell'anno e il tasso
// effettivo (imposta+INPS / imponibile) già calcolato dal backend. Ritorna:
//   - rows: fatture incassate nell'anno, con imponibile e da-accantonare
//   - totals: lordo (imponibile, netto ritenuta), daAccantonare, versato, gap
//   - cumulative: serie mese 1..12 (maturato / versato CUMULATI)
//   - deferred: fatture emesse nell'anno ma non ancora incassate nell'anno
//
// PURO: nessun DOM, nessun fetch, nessun side-effect.

import { annoIncassoOf, meseIncassoOf, importoRicavoCassa } from '@shared/ricavi-cassa';

export interface AccFattura {
  importo: number;
  ritenuta?: number | null;
  data: string;           // ISO date (YYYY-MM-DD)
  annoProgressivo?: number | null;
  pagAnno?: number | null;
  pagMese?: number | null;
  stato?: string | null;
  tipoDocumento?: string | null;
  dataPagamento?: string | null;
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

// ── Costanti ─────────────────────────────────────────────────────────────────

/**
 * Soli tipi di pagamento che rappresentano imposta sostitutiva e/o contributi
 * INPS, e quindi vanno conteggiati in "versato" nel confronto maturato/versato.
 * Esclusi: bollo, camera, inail, altro (non sono tasse/contributi P.IVA).
 */
const VERSATO_TIPI = new Set(['tasse', 'contributi', 'misto']);

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
  // Regole di cassa condivise (@shared/ricavi-cassa): anno di incasso (pag_anno
  // o dataPagamento), bozze escluse, note di credito (TD04) col segno negativo
  // (fix A5: prima le NC gonfiavano l'accantonamento invece di ridurlo).
  const rows: AccRow[] = [];
  for (const f of fatture) {
    if (annoIncassoOf(f) !== year) continue;
    const lordo = importoRicavoCassa(f);
    const mese = meseIncassoOf(f) ?? monthFromDate(f.data);
    // Fix re-audit MEDIO #5: NON clampiamo la singola riga a 0. Una nota di
    // credito (TD04) ha `lordo` negativo e deve SOTTRARSI dall'imponibile (come
    // fa il server in sommaRicaviCassa), non essere azzerata. Il clamp resta
    // solo sul TOTALE annuo, per non mostrare un accantonamento negativo.
    rows.push({
      label: labelFromFattura(f),
      mese,
      lordo: round2(lordo),
      daAccantonare: round2(lordo * rate),
    });
  }

  // Ordina per mese
  rows.sort((a, b) => a.mese - b.mese);

  // ── totals ───────────────────────────────────────────────────────────────
  const totaleLordo = round2(Math.max(0, rows.reduce((s, r) => s + r.lordo, 0)));
  const totaleDaAccantonare = round2(Math.max(0, rows.reduce((s, r) => s + r.daAccantonare, 0)));
  const totaleVersato = round2(pagamenti
    .filter((p) => p.tipo != null && VERSATO_TIPI.has(p.tipo))
    .reduce((s, p) => s + (Number(p.importo) || 0), 0));
  const gap = round2(totaleDaAccantonare - totaleVersato);

  // ── cumulative ───────────────────────────────────────────────────────────
  const cumulative: AccCumPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const maturato = round2(Math.max(0, rows
      .filter((r) => r.mese <= m)
      .reduce((s, r) => s + r.daAccantonare, 0)));
    const versato = round2(pagamenti
      .filter((p) => p.tipo != null && VERSATO_TIPI.has(p.tipo) && monthFromDate(p.data) <= m)
      .reduce((s, p) => s + (Number(p.importo) || 0), 0));
    cumulative.push({ month: m, maturato, versato });
  }

  // ── deferred: emesse nell'anno ma non incassate nell'anno ────────────────
  // Fix re-audit #16: usiamo annoIncassoOf (come le rows) invece di f.pagAnno,
  // così una fattura incassata via dataPagamento (pagAnno null) non compare sia
  // in rows sia in deferred.
  const deferred: AccDeferred[] = [];
  for (const f of fatture) {
    const annoEmissione = Number(f.data.slice(0, 4));
    if (annoEmissione !== year) continue;   // non emessa quest'anno
    if (annoIncassoOf(f) === year) continue; // già incassata nell'anno → rows
    deferred.push({
      label: labelFromFattura(f),
      importo: Number(f.importo) || 0,
      annoIncasso: annoIncassoOf(f),
    });
  }

  return { rows, totals: { lordo: totaleLordo, daAccantonare: totaleDaAccantonare, versato: totaleVersato, gap }, cumulative, deferred };
}
