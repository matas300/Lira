// src/shared/schemas.ts
import { z } from 'zod';
import {
  isValidPartitaIvaIT,
  isValidCodiceFiscaleFormat,
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
  overrides: z.record(z.unknown()).optional(),
});

export const YearSettingsPublic = YearSettingsInput.extend({
  year: z.number().int(),
});

// ───── Pagamenti ─────
export const ScheduleKeyBreakdown = z.object({
  key: z.string(),
  amount: z.number(),
});

export const PagamentoTipoEnum = z.enum(['tasse', 'contributi', 'misto', 'altro', 'inail', 'camera', 'bollo']);

export const PagamentoCreateInput = z.object({
  year: z.number().int(),
  data: z.string(),
  tipo: PagamentoTipoEnum,
  descrizione: z.string().optional(),
  importo: z.number(),
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
  data: z.string().optional(),
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
    .refine((c: any) => c.codiceFiscale == null || isValidCodiceFiscaleFormat(c.codiceFiscale), {
      message: 'Codice fiscale: formato non valido (16 alfanumerici)', path: ['codiceFiscale'],
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
