import { z } from 'zod';
import { RegimeEnum, InpsModeEnum } from '@shared/schemas';

export const zProfile = z.object({ id: z.string().min(1), userId: z.string().min(1), slug: z.string().min(1), displayName: z.string().min(1) }).passthrough();
export const zYearSettings = z.object({ profileId: z.string().min(1), year: z.number().int().gte(2000).lte(2100), regime: RegimeEnum, coefficiente: z.number().gt(0).lte(1), impostaSostitutiva: z.number().gte(0).lte(1), inpsMode: InpsModeEnum }).passthrough();
export const zCliente = z.object({ id: z.string().min(1), profileId: z.string().min(1), nome: z.string().min(1) }).passthrough();
export const zFattura = z.object({ id: z.string().min(1), profileId: z.string().min(1), annoProgressivo: z.number().int(), progressivo: z.number().int(), data: z.string().min(1), importo: z.number() }).passthrough();
export const zPagamento = z.object({ id: z.string().min(1), profileId: z.string().min(1), year: z.number().int(), data: z.string().min(1), tipo: z.string().min(1), importo: z.number() }).passthrough();
export const zCalendar = z.object({ profileId: z.string().min(1), year: z.number().int(), month: z.number().int().gte(1).lte(12), day: z.number().int().gte(1).lte(31), activityCode: z.string().min(1) }).passthrough();
export const zBudget = z.object({ id: z.string().min(1), profileId: z.string().min(1), year: z.number().int(), nome: z.string().min(1), importo: z.number() }).passthrough();
export const zSpesa = z.object({ id: z.string().min(1), profileId: z.string().min(1), year: z.number().int(), titolo: z.string().min(1), costo: z.number(), deducibilita: z.number().gte(0).lte(1) }).passthrough();
export const zDichiarazione = z.object({ profileId: z.string().min(1), year: z.number().int(), tipo: z.string().min(1) }).passthrough();
