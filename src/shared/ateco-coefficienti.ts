// ATECO → coefficiente forfettario (DM 23/01/2015, Allegato 4 - legge 190/2014).
//
// Port da CalcoliVari/ateco-coefficienti.js: CalcoliVari espone 9 GRUPPI con
// atecoHint testuale (es. "45 - (46.2-46.9) - (47.1-47.7) - 47.9"). Qui
// trascriviamo l'intera tabella DM in forma strutturata (ranges + literals)
// e implementiamo il lookup per codice ATECO completo NN.NN.NN tramite
// prefix matching contro gli intervalli ufficiali.

export const COEFFICIENTI_VALIDI = Object.freeze([0.40, 0.54, 0.62, 0.67, 0.78, 0.86] as const);

export type CoefficienteAmmesso = (typeof COEFFICIENTI_VALIDI)[number];

/**
 * Gruppo ATECO secondo DM 23/01/2015 Allegato 4.
 * `coefficiente` è in forma decimale (0.40 = 40%).
 * `ranges` elenca i prefissi/intervalli che afferiscono al gruppo;
 * il match è prefix-based su una scala gerarchica (divisione `NN`,
 * gruppo `NN.N`, classe `NN.NN`, categoria `NN.NN.N`).
 */
interface GruppoAteco {
  readonly id: string;
  readonly label: string;
  readonly coefficiente: CoefficienteAmmesso;
  readonly atecoHint: string;
  readonly ranges: readonly AtecoRange[];
}

/**
 * Intervallo o codice puntuale di ATECO. Tutti i confronti sono in stringa
 * (no parsing numerico) per preservare i bordi tipo "46.2" che includono
 * tutti i sotto-codici "46.2x", "46.2x.xx".
 */
type AtecoRange =
  | { readonly kind: 'literal'; readonly prefix: string }
  | { readonly kind: 'range'; readonly from: string; readonly to: string };

// Codice ATECO completo a livello sub-categoria: NN.NN.NN (6 cifre con due punti).
const ATECO_FULL_RE = /^(\d{2})\.(\d{2})\.(\d{2})$/;

// Mappa GRUPPI: trascrizione fedele del DM 23/01/2015 Allegato 4.
// I labels e atecoHint riprendono CalcoliVari/ateco-coefficienti.js.
const GRUPPI_ATECO: readonly GruppoAteco[] = Object.freeze([
  Object.freeze({
    id: 'g1',
    label: 'Industrie alimentari e delle bevande',
    coefficiente: 0.40,
    atecoHint: '(10 - 11)',
    ranges: Object.freeze([
      { kind: 'range', from: '10', to: '11' },
    ] as const),
  }),
  Object.freeze({
    id: 'g2',
    label: "Commercio all'ingrosso e al dettaglio",
    coefficiente: 0.40,
    atecoHint: '45 - (46.2-46.9) - (47.1-47.7) - 47.9',
    ranges: Object.freeze([
      { kind: 'literal', prefix: '45' },
      { kind: 'range', from: '46.2', to: '46.9' },
      { kind: 'range', from: '47.1', to: '47.7' },
      { kind: 'literal', prefix: '47.9' },
    ] as const),
  }),
  Object.freeze({
    id: 'g3',
    label: 'Commercio ambulante di prodotti alimentari e bevande',
    coefficiente: 0.40,
    atecoHint: '47.81',
    ranges: Object.freeze([
      { kind: 'literal', prefix: '47.81' },
    ] as const),
  }),
  Object.freeze({
    id: 'g4',
    label: 'Commercio ambulante di altri prodotti',
    coefficiente: 0.54,
    atecoHint: '47.82 - 47.89',
    ranges: Object.freeze([
      { kind: 'literal', prefix: '47.82' },
      { kind: 'literal', prefix: '47.89' },
    ] as const),
  }),
  Object.freeze({
    id: 'g5',
    label: 'Costruzioni e attività immobiliari',
    coefficiente: 0.86,
    atecoHint: '(41 - 42 - 43) - 68',
    ranges: Object.freeze([
      { kind: 'range', from: '41', to: '43' },
      { kind: 'literal', prefix: '68' },
    ] as const),
  }),
  Object.freeze({
    id: 'g6',
    label: 'Intermediari del commercio',
    coefficiente: 0.62,
    atecoHint: '46.1',
    ranges: Object.freeze([
      { kind: 'literal', prefix: '46.1' },
    ] as const),
  }),
  Object.freeze({
    id: 'g7',
    label: 'Attività di servizi di alloggio e ristorazione',
    coefficiente: 0.40,
    atecoHint: '(55 - 56)',
    ranges: Object.freeze([
      { kind: 'range', from: '55', to: '56' },
    ] as const),
  }),
  Object.freeze({
    id: 'g8',
    label:
      'Attività professionali, scientifiche, tecniche, sanitarie, di istruzione, servizi finanziari ed assicurativi',
    coefficiente: 0.78,
    atecoHint: '(64-66) - (69-75) - 85 - (86-88)',
    ranges: Object.freeze([
      { kind: 'range', from: '64', to: '66' },
      { kind: 'range', from: '69', to: '75' },
      { kind: 'literal', prefix: '85' },
      { kind: 'range', from: '86', to: '88' },
    ] as const),
  }),
  Object.freeze({
    id: 'g9',
    label: 'Altre attività economiche',
    coefficiente: 0.67,
    atecoHint:
      '(01-03) - (05-09) - (12-33) - 35 - (36-39) - (49-53) - (58-63) - (77-82) - 84 - (90-99)',
    ranges: Object.freeze([
      { kind: 'range', from: '01', to: '03' },
      { kind: 'range', from: '05', to: '09' },
      { kind: 'range', from: '12', to: '33' },
      { kind: 'literal', prefix: '35' },
      { kind: 'range', from: '36', to: '39' },
      { kind: 'range', from: '49', to: '53' },
      { kind: 'range', from: '58', to: '63' },
      { kind: 'range', from: '77', to: '82' },
      { kind: 'literal', prefix: '84' },
      { kind: 'range', from: '90', to: '99' },
    ] as const),
  }),
] as const);

/**
 * True se il coefficiente passato è uno dei 6 ammessi dal DM (40/54/62/67/78/86%).
 * Confronto con tolleranza float a 2 decimali per assorbire arrotondamenti
 * tipo `0.40000000000001`.
 */
export function isCoefficienteAmmesso(c: number): boolean {
  if (!Number.isFinite(c)) return false;
  const rounded = Math.round(c * 100) / 100;
  return (COEFFICIENTI_VALIDI as readonly number[]).includes(rounded);
}

/**
 * Risolve il coefficiente di redditività per un codice ATECO completo
 * `NN.NN.NN`. Ritorna `null` se il formato è invalido oppure se il codice
 * non rientra in alcun gruppo del DM (caso teorico: la copertura DM è
 * progettata per essere totale sulle attività ammesse al forfettario).
 */
export function getCoefficienteByAteco(codice: string): number | null {
  const gruppo = getGruppoByAteco(codice);
  return gruppo ? gruppo.coefficiente : null;
}

/**
 * Variante che restituisce il gruppo intero (utile per UI/diagnostica).
 */
function getGruppoByAteco(codice: string): GruppoAteco | null {
  if (typeof codice !== 'string') return null;
  const match = ATECO_FULL_RE.exec(codice);
  if (!match) return null;
  for (const gruppo of GRUPPI_ATECO) {
    if (matchesAnyRange(codice, gruppo.ranges)) return gruppo;
  }
  return null;
}

function matchesAnyRange(codice: string, ranges: readonly AtecoRange[]): boolean {
  for (const r of ranges) {
    if (r.kind === 'literal') {
      if (matchesLiteral(codice, r.prefix)) return true;
    } else if (matchesRange(codice, r.from, r.to)) {
      return true;
    }
  }
  return false;
}

/**
 * Match di un prefisso DM (divisione `NN`, gruppo `NN.N`, classe `NN.NN`,
 * categoria `NN.NN.N`) contro il codice completo `NN.NN.NN`. Si usa pure
 * prefix matching: la gerarchia ATECO 2007 + il formato fisso del codice
 * (regex `^NN\.NN\.NN$`) garantiscono che `startsWith` non produca falsi
 * positivi (es. "46.1" non può matchare "46.21.00" perché "21" non inizia
 * con "1").
 *
 * Esempi:
 *   matchesLiteral("47.91.10", "47.9")    → true   (gruppo 479)
 *   matchesLiteral("46.12.00", "46.1")    → true   (gruppo 461)
 *   matchesLiteral("46.21.00", "46.1")    → false
 *   matchesLiteral("47.81.10", "47.81")   → true   (classe 4781)
 *   matchesLiteral("85.10.00", "85")      → true   (divisione 85)
 */
function matchesLiteral(codice: string, prefix: string): boolean {
  return codice.startsWith(prefix);
}

/**
 * Verifica se il codice ricade nell'intervallo `[from, to]` inclusi.
 * Gli estremi `from`/`to` hanno la stessa lunghezza (sempre 2 caratteri
 * per divisioni, 4 per gruppi `NN.N`). Il confronto è lessicografico
 * su sottostringa di pari lunghezza, che equivale al confronto numerico
 * gerarchico perché il formato è fisso.
 *
 * Esempi:
 *   matchesRange("47.91.10", "47.1", "47.7") → false  (gruppo 479 fuori)
 *   matchesRange("47.71.00", "47.1", "47.7") → true
 *   matchesRange("62.10.00", "58",   "63")   → true   (divisione 62)
 *   matchesRange("46.21.00", "46.2", "46.9") → true
 */
function matchesRange(codice: string, from: string, to: string): boolean {
  const slice = codice.slice(0, from.length);
  return slice >= from && slice <= to;
}
