// src/server/middleware/error.ts
import type { ErrorHandler } from 'hono';
import type { StatusCode, ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(
    public status: StatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          // `details` è opzionale nel contratto: emettila solo se presente.
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      err.status as ContentfulStatusCode,
    );
  }
  console.error('[unhandled error]', err);
  return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500);
};
