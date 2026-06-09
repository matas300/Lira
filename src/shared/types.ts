// src/shared/types.ts
import type { z } from 'zod';
import {
  LoginInput as LoginInputSchema,
  LoginResponse as LoginResponseSchema,
  MeResponse as MeResponseSchema,
  UserPublic as UserPublicSchema,
  ProfilePublic as ProfilePublicSchema,
  ProfileCreateInput as ProfileCreateInputSchema,
  ErrorEnvelope as ErrorEnvelopeSchema,
  HealthResponse as HealthResponseSchema,
  TipoClienteEnum as TipoClienteEnumSchema,
  ClienteCreateInput as ClienteCreateInputSchema,
  ClienteUpdateInput as ClienteUpdateInputSchema,
  ClientePublic as ClientePublicSchema,
  PivaLookupData as PivaLookupDataSchema,
  PivaLookupResult as PivaLookupResultSchema,
  StatoFatturaEnum as StatoFatturaEnumSchema,
  TipoDocumentoEnum as TipoDocumentoEnumSchema,
  RigaSchema as RigaSchemaSchema,
  FatturaCreateInput as FatturaCreateInputSchema,
  FatturaUpdateInput as FatturaUpdateInputSchema,
  FatturaPublic as FatturaPublicSchema,
} from './schemas';

export type LoginInput = z.infer<typeof LoginInputSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type UserPublic = z.infer<typeof UserPublicSchema>;
export type ProfilePublic = z.infer<typeof ProfilePublicSchema>;
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type TipoCliente = z.infer<typeof TipoClienteEnumSchema>;
export type ClienteCreateInput = z.infer<typeof ClienteCreateInputSchema>;
export type ClienteUpdateInput = z.infer<typeof ClienteUpdateInputSchema>;
export type ClientePublic = z.infer<typeof ClientePublicSchema>;
export type PivaLookupData = z.infer<typeof PivaLookupDataSchema>;
export type PivaLookupResult = z.infer<typeof PivaLookupResultSchema>;
export type StatoFattura = z.infer<typeof StatoFatturaEnumSchema>;
export type TipoDocumento = z.infer<typeof TipoDocumentoEnumSchema>;
export type Riga = z.infer<typeof RigaSchemaSchema>;
export type FatturaCreateInput = z.infer<typeof FatturaCreateInputSchema>;
export type FatturaUpdateInput = z.infer<typeof FatturaUpdateInputSchema>;
export type FatturaPublic = z.infer<typeof FatturaPublicSchema>;

import { NotaCreditoCreateInput as NotaCreditoCreateInputSchema } from './schemas';
export type NotaCreditoCreateInput = z.infer<typeof NotaCreditoCreateInputSchema>;

import { ImportFatturaInput as ImportFatturaInputSchema } from './schemas';
export type ImportFatturaInput = z.infer<typeof ImportFatturaInputSchema>;
export interface ImportReport {
  importate: number;
  clientiCreati: number;
  saltate: Array<{ numero: string; motivo: string }>;
}
