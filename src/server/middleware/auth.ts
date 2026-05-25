// src/server/middleware/auth.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSession, refreshSession } from '../lib/session';
import type { Db } from '../db/client';
import { HttpError } from './error';

export const SESSION_COOKIE = 'lira_session';

export type AuthEnv = {
  Variables: {
    db: Db;
    userId: string;
    activeProfileId: string;
  };
};

export const requireSession: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Missing session cookie');
  }
  const db = c.get('db');
  const session = await getSession(db, sessionId);
  if (!session) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired session');
  }
  await refreshSession(db, session.id);
  c.set('userId', session.userId);
  c.set('activeProfileId', session.activeProfileId);
  await next();
};
