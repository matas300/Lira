// src/server/middleware/auth.ts
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getSession, needsRefresh, refreshSession, SESSION_TTL_MS } from '../lib/session';
import type { Db } from '../db/client';
import { HttpError } from './error';

export const SESSION_COOKIE = 'lira_session';

// Opzioni condivise login ↔ refresh: il cookie rinnovato deve avere gli
// stessi flag di quello emesso al login, altrimenti il browser lo tratta
// come cookie diverso.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

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
  // Rolling TTL throttled: rinnova DB *e* cookie (nuovo maxAge 30gg) solo se
  // l'ultimo refresh risale a >24h fa — niente UPDATE su Turso a ogni richiesta,
  // e il maxAge del cookie scorre insieme a expires_at sul DB.
  if (needsRefresh(session)) {
    await refreshSession(db, session.id);
    setCookie(c, SESSION_COOKIE, session.id, sessionCookieOptions());
  }
  c.set('userId', session.userId);
  c.set('activeProfileId', session.activeProfileId);
  await next();
};
