// Catalogo canonico delle famiglie di scadenze fiscali e helper per la
// costruzione/parsing delle chiavi schedule. Usato da tax-engine,
// scadenziario-engine e dalle route pagamenti come identificatore stabile
// e human-readable di una singola scadenza per un dato anno d'imposta.
//
// Formato chiave: `<family>_<year>`, es. `imposta_saldo_2025`,
// `inps_fissi_3_2025`. Il year è sempre a 4 cifre.
//
// Famiglie (14 totali):
// - Imposte sui redditi (saldo + 2 acconti): regole acconti art. 17 c. 3
//   DPR 435/2001, scadenza saldo + 1° acconto 30/06 (o 30/07 con +0,40%),
//   2° acconto 30/11.
// - Contributi previdenziali in dichiarazione (saldo + 2 acconti): stesse
//   date dei tributi.
// - INPS fissi (4 rate trimestrali artigiani/commercianti): 16/05, 20/08,
//   16/11, 16/02 dell'anno successivo (Circolare INPS annuale).
// - Bollo fatturazione elettronica (DM 17/06/2014): rata Q1+Q2+Q3 (31/05
//   dell'anno successivo) e rata Q4 (28/02 dell'anno successivo). Soglia
//   minima cumulativa 5.000 € per posticipo Q1/Q2; sotto soglia tutto in
//   rata unica (DM 4/12/2020).
// - Diritto camerale CCIAA: scadenza allineata al 1° acconto imposte.
// - INAIL (stub per estensione futura, attualmente non gestito da Lira ma
//   presente per evitare break del catalogo quando verrà introdotto).

export const SCHEDULE_FAMILIES = [
  'imposta_saldo',
  'imposta_acc1',
  'imposta_acc2',
  'contributi_saldo',
  'contributi_acc1',
  'contributi_acc2',
  'inps_fissi_1',
  'inps_fissi_2',
  'inps_fissi_3',
  'inps_fissi_4',
  'bollo_q123',
  'bollo_q4',
  'camera',
  'inail',
] as const;

export type ScheduleFamily = (typeof SCHEDULE_FAMILIES)[number];

const FAMILY_SET: ReadonlySet<string> = new Set<string>(SCHEDULE_FAMILIES);

/**
 * Costruisce una chiave schedule canonica nella forma `<family>_<year>`.
 * Non valida `year` oltre il tipo: il chiamante deve passare un anno valido
 * (Drizzle/Zod fanno il check al boundary DB/API).
 */
export function buildScheduleKey(family: ScheduleFamily, year: number): string {
  return `${family}_${year}`;
}

/**
 * Parsea una chiave schedule. Ritorna `null` se la chiave è malformata o se
 * la famiglia non è registrata in `SCHEDULE_FAMILIES`. La regex è greedy a
 * sinistra: l'anno è sempre il blocco finale `_<4 cifre>`, quindi famiglie
 * con suffisso numerico (es. `inps_fissi_3`) vengono parsate correttamente.
 *
 * Esempi:
 * - `imposta_saldo_2025` → `{ family: 'imposta_saldo', year: 2025 }`
 * - `inps_fissi_3_2025` → `{ family: 'inps_fissi_3', year: 2025 }`
 * - `garbage` → `null`
 * - `imposta_saldo_abc` → `null` (anno non numerico)
 * - `inesistente_2025` → `null` (famiglia sconosciuta)
 */
export function parseScheduleKey(
  key: string,
): { family: ScheduleFamily; year: number } | null {
  const m = key.match(/^([a-z_0-9]+)_(\d{4})$/);
  if (!m) return null;
  const family = m[1]!;
  const year = parseInt(m[2]!, 10);
  if (!FAMILY_SET.has(family)) return null;
  return { family: family as ScheduleFamily, year };
}
