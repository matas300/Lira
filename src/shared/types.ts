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
} from './schemas';

export type LoginInput = z.infer<typeof LoginInputSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
export type UserPublic = z.infer<typeof UserPublicSchema>;
export type ProfilePublic = z.infer<typeof ProfilePublicSchema>;
export type ProfileCreateInput = z.infer<typeof ProfileCreateInputSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
