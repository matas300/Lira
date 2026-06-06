// src/server/middleware/validate.ts
//
// Wrapper su @hono/zod-validator che converte i fallimenti Zod nell'envelope
// standard dell'app: HttpError(400, 'VALIDATION', message, details) → errorHandler.
// Riusabile da tutte le route (clienti 4A in poi).

import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';
import { HttpError } from './error';

export function zJson<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      throw new HttpError(
        400,
        'VALIDATION',
        'Dati non validi',
        result.error.issues,
      );
    }
  });
}
