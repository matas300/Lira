// src/shared/schemas.ts
import { z } from 'zod';
import {
  isValidPartitaIvaIT,
  isValidCodiceFiscale,
  isValidCodiceSdi,
  isValidPec,
} from './validators';

// ───── Auth ─────
export const LoginInput = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  password: z.string().min(8).max(200),
});

export const UserPublic = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

export const ProfilePublic = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  giorniIncasso: z.number(),
  // Range degli anni con year_settings configurate (null se il profilo non ne
  // ha ancora). Il client lo usa per agganciare l'anno selezionato al profilo
  // attivo ed evitare di atterrare su un anno non configurato dopo lo switch.
  minYear: z.number().nullable().optional(),
  maxYear: z.number().nullable().optional(),
});

export const MeResponse = z.object({
  user: UserPublic,
  profiles: z.array(ProfilePublic),
  activeProfile: ProfilePublic,
});

export const LoginResponse = MeResponse;

// ───── Profiles ─────
export const ProfileCreateInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'slug: solo lowercase alfanum e trattini'),
  displayName: z.string().min(1).max(100),
});

// Editor profilo (anagrafica/attività): tutti i campi opzionali, stringa vuota
// ammessa (postura permissiva — la validazione di formato è inline lato client,
// il blocco duro resta al confine XML in shared/cedente.ts).
// NB: a differenza di optStr (top-level, usato dagli schemi cliente) optProfileStr NON
// fa trim e non è nullable, ma ha max(200) e ammette stringa vuota (postura permissiva editor profilo).
const optProfileStr = z.string().max(200).optional();
const optUpper = z.string().max(200).optional().transform((s) => (s == null ? s : s.trim().toUpperCase()));

const Indirizzo = z.object({
  indirizzo: optProfileStr,
  cap: optProfileStr,
  citta: optProfileStr,
  provincia: optUpper,
});

export const ProfileAnagrafica = z.object({
  cf: optUpper,
  nome: optProfileStr,
  cognome: optProfileStr,
  sesso: optProfileStr,
  data_nascita: optProfileStr,
  comune_nascita: optProfileStr,
  prov_nascita: optUpper,
  residenza: Indirizzo.optional(),
  domicilio_fiscale: Indirizzo.optional(),
  telefono: optProfileStr,
  email: optProfileStr,
  iban: optProfileStr,
  modalita_pagamento: optProfileStr,
});

export const ProfileAttivita = z.object({
  partita_iva: optProfileStr,
  codice_ateco: optProfileStr,
  ateco_gruppo: optProfileStr,
  descrizione_attivita: optProfileStr,
  comune_domicilio: optProfileStr,
  data_inizio_attivita: optProfileStr,
});

export const ProfilePatchInput = z.object({
  displayName: z.string().min(1).max(100).optional(),
  giorniIncasso: z.number().int().min(0).max(365).optional(),
  anagrafica: ProfileAnagrafica.optional(),
  attivita: ProfileAttivita.optional(),
});

// ───── Error envelope ─────
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const OkEnvelope = z.object({ ok: z.literal(true) });

export const HealthResponse = z.object({
  ok: z.literal(true),
  version: z.string(),
});

// ───── Year settings ─────
export const RegimeEnum = z.enum(['forfettario', 'ordinario']);
export const InpsModeEnum = z.enum(['artigiani_commercianti', 'gestione_separata']);
export const InpsCategoriaEnum = z.enum(['artigiano', 'commerciante']).nullable();
export const ScadenziarioMetodoEnum = z.enum(['storico', 'previsionale']);

export const YearSettingsInput = z.object({
  regime: RegimeEnum,
  coefficiente: z.number().min(0).max(1),
  impostaSostitutiva: z.number().refine((v) => v === 0.05 || v === 0.15, { message: 'sostitutiva deve essere 0.05 o 0.15' }),
  inpsMode: InpsModeEnum,
  inpsCategoria: InpsCategoriaEnum,
  riduzione35: z.union([z.literal(0), z.literal(1)]).default(0),
  riduzione35Comunicata: z.union([z.literal(0), z.literal(1)]).default(0),
  riduzione35DataComunicazione: z.string().nullable().optional(),
  haRedditoDipendente: z.union([z.literal(0), z.literal(1)]).default(0),
  limiteForfettario: z.number().int().default(85000),
  scadenziarioMetodo: ScadenziarioMetodoEnum.default('storico'),
  prorogaSaldoAt: z.string().nullable().optional()
    .refine((v) => v == null || /^\d{4}-07-\d{2}$/.test(v), { message: 'prorogaSaldoAt deve essere in luglio' }),
  primoAnnoFatturatoPrec: z.number().nullable().optional(),
  primoAnnoImpostaPrec: z.number().nullable().optional(),
  primoAnnoAccontiImpostaPrec: z.number().nullable().optional(),
  primoAnnoContribVariabiliPrec: z.number().nullable().optional(),
  primoAnnoAccontiContribPrec: z.number().nullable().optional(),
  tariffaGiornaliera: z.number().nonnegative().nullable().optional(),
  overrides: z.record(z.unknown()).optional(),
});

export const YearSettingsPublic = YearSettingsInput.extend({
  year: z.number().int(),
});

// ───── Date ISO ─────
/**
 * Data ISO YYYY-MM-DD che esiste davvero nel calendario: la sola regex
 * accettava "2026-99-99". Round-trip via Date UTC: se i componenti non
 * combaciano la data era invalida (es. 2026-02-30 → 2026-03-02).
 */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data attesa in formato YYYY-MM-DD')
  .refine((s) => {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, { message: 'Data inesistente nel calendario' });

// ───── Pagamenti ─────
export const ScheduleKeyBreakdown = z.object({
  key: z.string(),
  amount: z.number(),
});

export const PagamentoTipoEnum = z.enum(['tasse', 'contributi', 'misto', 'altro', 'inail', 'camera', 'bollo']);

export const PagamentoCreateInput = z.object({
  // Bound ragionevoli (audit M17): year nel range gestibile, data reale, importo > 0.
  year: z.number().int().min(2000).max(2100),
  data: IsoDate,
  tipo: PagamentoTipoEnum,
  descrizione: z.string().optional(),
  importo: z.number().positive(),
  scheduleKey: z.string().nullable().optional(),
  linkedKeys: z.array(ScheduleKeyBreakdown).optional(),
  note: z.string().optional(),
});

export const PagamentoPublic = PagamentoCreateInput.extend({
  id: z.string(),
  profileId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PagamentoQuickPayInput = z.object({
  scheduleKey: z.string(),
  importo: z.number().optional(),
  data: IsoDate.optional(),
  tipo: PagamentoTipoEnum.optional(),
});

// ───── Audit warnings ─────
export const WarningSeverityEnum = z.enum(['info', 'warning', 'block']);
export const AuditWarningSchema = z.object({
  code: z.string(),
  severity: WarningSeverityEnum,
  title: z.string(),
  message: z.string(),
  suggestedAction: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  confirmed: z.boolean().optional(),
});

// ───── Tax simulation ─────
export const TaxSimulateInput = z.object({
  year: z.number().int(),
  grossCollected: z.number(),
  settings: YearSettingsInput.partial().optional(),
  method: ScadenziarioMetodoEnum.optional(),
});

// ───── Clienti (Slice 4A) ─────
export const TipoClienteEnum = z.enum(['PF', 'PG', 'PA', 'Estero']);

const optStr = z.string().trim().optional().nullable();

const ClienteBase = z.object({
  nome: z.string().trim().min(1).max(200),
  tipoCliente: TipoClienteEnum.default('PG'),
  partitaIva: z.string().trim().optional().nullable().transform((v) => (v ? v : null)),
  codiceFiscale: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v ? v : null)),
  codiceSdi: z.string().trim().toUpperCase().default('0000000'),
  pec: optStr,
  indirizzo: optStr,
  cap: optStr,
  citta: optStr,
  provincia: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v ? v : null)),
  nazione: z.string().trim().toUpperCase().length(2).default('IT'),
  descrizioneStandard: optStr,
  note: optStr,
  isDefault: z.boolean().optional(),
});

function applyClienteRefines<T extends z.ZodTypeAny>(schema: T): T {
  return schema
    .refine((c: any) => c.partitaIva == null || isValidPartitaIvaIT(c.partitaIva), {
      message: 'Partita IVA non valida (check-digit)', path: ['partitaIva'],
    })
    .refine((c: any) => c.codiceFiscale == null || isValidCodiceFiscale(c.codiceFiscale), {
      message: 'Codice fiscale non valido (carattere di controllo errato → scarto SdI)', path: ['codiceFiscale'],
    })
    .refine((c: any) => c.codiceSdi == null || c.tipoCliente == null
      || isValidCodiceSdi(c.codiceSdi, c.tipoCliente), {
      message: 'Codice SDI non valido per il tipo cliente', path: ['codiceSdi'],
    })
    .refine((c: any) => c.pec == null || isValidPec(c.pec), {
      message: 'PEC non valida', path: ['pec'],
    })
    .refine((c: any) => c.nazione !== 'IT' || c.partitaIva != null || c.codiceFiscale != null, {
      message: 'Cliente italiano: richiesta Partita IVA o Codice Fiscale (FatturaPA §1.4.1.2)',
      path: ['partitaIva'],
    }) as unknown as T;
}

export const ClienteCreateInput = applyClienteRefines(ClienteBase);
export const ClienteUpdateInput = applyClienteRefines(ClienteBase.partial());

export const ClientePublic = z.object({
  id: z.string(),
  profileId: z.string(),
  nome: z.string(),
  tipoCliente: TipoClienteEnum,
  partitaIva: z.string().nullable(),
  codiceFiscale: z.string().nullable(),
  codiceSdi: z.string(),
  pec: z.string().nullable(),
  indirizzo: z.string().nullable(),
  cap: z.string().nullable(),
  citta: z.string().nullable(),
  provincia: z.string().nullable(),
  nazione: z.string(),
  descrizioneStandard: z.string().nullable(),
  isDefault: z.boolean(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PivaLookupData = z.object({
  nome: z.string().optional(),
  codiceFiscale: z.string().optional(),
  indirizzo: z.string().optional(),
  cap: z.string().optional(),
  citta: z.string().optional(),
  provincia: z.string().optional(),
  pec: z.string().optional(),
  codiceSdi: z.string().optional(),
});

export const PivaLookupResult = z.object({
  ok: z.boolean(),
  data: PivaLookupData.optional(),
  code: z.string().optional(),
});

// ───── Fatture (Slice 5A) ─────

// 'annullata' rimossa (audit B22): nessuna transizione la raggiungeva.
export const StatoFatturaEnum = z.enum(['bozza', 'inviata', 'pagata', 'stornata']);
// TD24 rimosso (audit B22): non supportato dal builder XML (veniva castato a TD01).
export const TipoDocumentoEnum = z.enum(['TD01', 'TD04']);

export const RigaSchema = z.object({
  descrizione: z.string().trim().min(1).max(1000),
  quantita: z.number().positive().default(1),
  prezzoUnitario: z.number(),
});

export const FatturaCreateInput = z.object({
  clienteId: z.string().min(1),
  tipoDocumento: TipoDocumentoEnum.default('TD01'),
  data: IsoDate,
  righe: z.array(RigaSchema).min(1, 'Almeno una riga'),
  ritenuta: z.number().min(0).default(0),
  aliquotaRitenuta: z.number().optional().nullable(),
  tipoRitenuta: z.string().trim().optional().nullable(),
  causaleRitenuta: z.string().trim().optional().nullable(),
  contributoIntegrativo: z.number().min(0).default(0),
  marcaDaBollo: z.boolean().default(false),
  bolloAddebitato: z.boolean().default(false),
  modalitaPagamento: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

export const FatturaUpdateInput = FatturaCreateInput.partial();

const RigaPublic = z.object({
  descrizione: z.string(),
  quantita: z.number(),
  prezzoUnitario: z.number(),
});

export const FatturaPublic = z.object({
  id: z.string(),
  profileId: z.string(),
  clienteId: z.string().nullable(),
  tipoDocumento: TipoDocumentoEnum,
  annoProgressivo: z.number(),
  progressivo: z.number().nullable(),
  numeroDisplay: z.string().nullable(),
  fatturaOriginaleId: z.string().nullable(),
  tipoStorno: z.string().nullable(),
  ncTotaleImporto: z.number(),
  data: z.string(),
  clienteSnapshot: z.record(z.unknown()).nullable(),
  righe: z.array(RigaPublic),
  importo: z.number(),
  ritenuta: z.number(),
  aliquotaRitenuta: z.number().nullable(),
  tipoRitenuta: z.string().nullable(),
  causaleRitenuta: z.string().nullable(),
  contributoIntegrativo: z.number(),
  marcaDaBollo: z.boolean(),
  bolloAddebitato: z.boolean(),
  stato: StatoFatturaEnum,
  dataInvioSdi: z.string().nullable(),
  dataPagamento: z.string().nullable(),
  pagMese: z.number().nullable(),
  pagAnno: z.number().nullable(),
  modalitaPagamento: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ───── Note di Credito (Slice 5C) ─────

export const NotaCreditoCreateInput = z.object({
  data: IsoDate,
  righe: z.array(RigaSchema).min(1, 'Almeno una riga'),
  note: z.string().trim().optional().nullable(),
});

// ───── Calendario (Slice A) ─────
export const ActivityCodeEnum = z.enum(['8', 'M', 'F', 'FS', 'Malattia', 'Donazione', 'WE']);
export const CalendarEntryInput = z.object({ activityCode: ActivityCodeEnum });
export type CalendarEntryInputT = z.infer<typeof CalendarEntryInput>;

// ─────────────────────────── budget ───────────────────────────

export const BudgetItemInput = z.object({
  nome: z.string().trim().max(120),
  importo: z.number().nonnegative(),
  auto: z.boolean(),
  ordine: z.number().int().min(0),
});
export type BudgetItemInputT = z.infer<typeof BudgetItemInput>;

export const BudgetPutInput = z.object({
  baseMonth: z.number().int().min(1).max(12).nullable(),
  items: z.array(BudgetItemInput).max(100),
});
export type BudgetPutInputT = z.infer<typeof BudgetPutInput>;

// ───── Import XML FatturaPA (Slice 5E) ─────

export const ImportClienteSnapshot = z.object({
  nome: z.string(),
  tipoCliente: z.string(),
  partitaIva: z.string().nullable().optional(),
  codiceFiscale: z.string().nullable().optional(),
  codiceSdi: z.string().nullable().optional(),
  pec: z.string().nullable().optional(),
  indirizzo: z.string().nullable().optional(),
  cap: z.string().nullable().optional(),
  citta: z.string().nullable().optional(),
  provincia: z.string().nullable().optional(),
  nazione: z.string(),
});

export const ImportFatturaInput = z.object({
  tipoDocumento: TipoDocumentoEnum,
  numero: z.string(),
  data: IsoDate,
  annoProgressivo: z.number().int(),
  progressivo: z.number().int(),
  numeroDisplay: z.string(),
  righe: z.array(RigaSchema).min(1),
  importo: z.number(),
  marcaDaBollo: z.boolean(),
  modalitaPagamento: z.string().nullable().default(null),
  clienteSnapshot: ImportClienteSnapshot,
  // Identificativi del CedentePrestatore estratti dall'XML (audit C3): il
  // server li confronta con la P.IVA/CF del profilo per rifiutare l'import di
  // fatture PASSIVE (di fornitori) come attive.
  cedentePartitaIva: z.string().nullable().optional(),
  cedenteCodiceFiscale: z.string().nullable().optional(),
});

// Envelope volutamente lasco (audit M15): la validazione di ogni item avviene
// PER-ITEM nel route con ImportFatturaInput.safeParse — un item malformato
// finisce nel report come errore, gli altri vengono importati.
export const ImportXmlBody = z.object({
  items: z.array(z.unknown()).min(1).max(500),
});
