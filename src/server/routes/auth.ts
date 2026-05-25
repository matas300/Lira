// src/server/routes/auth.ts
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { LoginInput } from '@shared/schemas';
import { findUserByEmail, listProfilesForUser } from '../lib/users';
import { hashPassword, verifyPassword } from '../lib/password';
import { createSession, deleteSession, SESSION_TTL_MS } from '../lib/session';
import { requireSession, SESSION_COOKIE, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { users } from '../db/schema';
import type { Db } from '../db/client';

export const authRoute = new Hono<AuthEnv>();

// Dummy hash precomputato per mitigare timing attack (lazy, 1x al primo uso)
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword('00000000000000000000000000000000');
  return dummyHash;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

async function mePayload(db: Db, userId: string, activeProfileId: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new HttpError(500, 'NO_USER', 'User missing');

  const profs = await listProfilesForUser(db, userId);
  if (profs.length === 0) throw new HttpError(500, 'NO_PROFILE', 'User has no profile');
  const active = profs.find((p) => p.id === activeProfileId) ?? profs[0]!;

  return {
    user,
    profiles: profs.map((p) => ({
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      giorniIncasso: p.giorniIncasso,
    })),
    activeProfile: {
      id: active.id,
      slug: active.slug,
      displayName: active.displayName,
      giorniIncasso: active.giorniIncasso,
    },
  };
}

authRoute.post('/login', zValidator('json', LoginInput), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = c.get('db');
  const user = await findUserByEmail(db, email);

  if (!user) {
    // verify dummy per uguagliare timing rispetto al caso "user esistente con password sbagliata"
    await verifyPassword(await getDummyHash(), password);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password non validi');
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password non validi');

  const profs = await listProfilesForUser(db, user.id);
  if (profs.length === 0) throw new HttpError(500, 'NO_PROFILE', 'User has no profile');
  const first = profs[0]!;
  const session = await createSession(db, user.id, first.id);
  setCookie(c, SESSION_COOKIE, session.id, cookieOptions());

  return c.json(await mePayload(db, user.id, session.activeProfileId));
});

authRoute.post('/logout', requireSession, async (c) => {
  const db = c.get('db');
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) await deleteSession(db, sessionId);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoute.get('/me', requireSession, async (c) => {
  const db = c.get('db');
  return c.json(await mePayload(db, c.get('userId'), c.get('activeProfileId')));
});

export async function initAuthRoute(): Promise<void> {
  await getDummyHash();
}
