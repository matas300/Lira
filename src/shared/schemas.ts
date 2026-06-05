// src/shared/schemas.ts
import { z } from 'zod';

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
