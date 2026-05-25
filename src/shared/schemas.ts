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
