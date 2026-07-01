// src/server/routes/auth.ts
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { eq, inArray, min, max } from 'drizzle-orm';
import type { Context } from 'hono';
import { LoginInput } from '@shared/schemas';
import { findUserByEmail, listProfilesForUser } from '../lib/users';
import { hashPassword, verifyPassword } from '../lib/password';
import { createSession, deleteSession, deleteExpiredSessions } from '../lib/session';
import { requireSession, sessionCookieOptions, SESSION_COOKIE, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { users, yearSettings } from '../db/schema';
import type { Db } from '../db/client';

export const authRoute = new Hono<AuthEnv>();

// Dummy hash precomputato per mitigare timing attack (lazy, 1x al primo uso)
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword('00000000000000000000000000000000');
  return dummyHash;
}

// ── Rate limit login per IP (in-memory) ─────────────────────────────────────
// Max 10 tentativi FALLITI per IP in una finestra di 15 minuti → 429. Il login
// riuscito resetta il contatore. In-process e in-memory: una sola istanza Fly,
// 3 utenti — niente store esterno. Pulizia lazy: le entry scadute vengono
// rimosse quando incontrate, più sweep completo quando la mappa cresce.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAP_SWEEP_THRESHOLD = 1000;

type FailureEntry = { count: number; firstFailAt: number };
const loginFailures = new Map<string, FailureEntry>();

function clientIp(c: Context): string {
  // Dietro il proxy Fly: Fly-Client-IP è l'IP reale del client. Fallback su
  // X-Forwarded-For (primo hop) e su una chiave fissa in dev/test.
  return (
    c.req.header('fly-client-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

function assertNotRateLimited(ip: string): void {
  const entry = loginFailures.get(ip);
  if (!entry) return;
  if (Date.now() - entry.firstFailAt >= LOGIN_WINDOW_MS) {
    loginFailures.delete(ip); // finestra scaduta → pulizia lazy
    return;
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    throw new HttpError(429, 'RATE_LIMITED', 'Troppi tentativi di login. Riprova tra qualche minuto.');
  }
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = loginFailures.get(ip);
  if (!entry || now - entry.firstFailAt >= LOGIN_WINDOW_MS) {
    loginFailures.set(ip, { count: 1, firstFailAt: now });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > LOGIN_MAP_SWEEP_THRESHOLD) {
    for (const [key, e] of loginFailures) {
      if (now - e.firstFailAt >= LOGIN_WINDOW_MS) loginFailures.delete(key);
    }
  }
}

function recordLoginSuccess(ip: string): void {
  loginFailures.delete(ip);
}

// Solo per i test: stato in-memory condiviso tra i casi.
export function resetLoginRateLimiter(): void {
  loginFailures.clear();
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

  // Range anni configurati (year_settings) per profilo, in una sola query
  // aggregata. Il client lo usa per agganciare l'anno selezionato al profilo.
  const ids = profs.map((p) => p.id);
  const yrRows = ids.length
    ? await db
        .select({
          profileId: yearSettings.profileId,
          minYear: min(yearSettings.year),
          maxYear: max(yearSettings.year),
        })
        .from(yearSettings)
        .where(inArray(yearSettings.profileId, ids))
        .groupBy(yearSettings.profileId)
    : [];
  const toNum = (v: unknown): number | null => (v == null ? null : Number(v));
  const yrMap = new Map(
    yrRows.map((r) => [r.profileId, { minYear: toNum(r.minYear), maxYear: toNum(r.maxYear) }]),
  );
  const withYears = (p: (typeof profs)[number]) => ({
    id: p.id,
    slug: p.slug,
    displayName: p.displayName,
    giorniIncasso: p.giorniIncasso,
    minYear: yrMap.get(p.id)?.minYear ?? null,
    maxYear: yrMap.get(p.id)?.maxYear ?? null,
  });

  return {
    user,
    profiles: profs.map(withYears),
    activeProfile: withYears(active),
  };
}

authRoute.post('/login', zJson(LoginInput), async (c) => {
  const ip = clientIp(c);
  assertNotRateLimited(ip); // prima di ogni verify: niente Argon2 per IP bloccati

  const { email, password } = c.req.valid('json');
  const db = c.get('db');
  const user = await findUserByEmail(db, email);

  if (!user) {
    // verify dummy per uguagliare timing rispetto al caso "user esistente con password sbagliata"
    await verifyPassword(await getDummyHash(), password);
    recordLoginFailure(ip);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password non validi');
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    recordLoginFailure(ip);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o password non validi');
  }
  recordLoginSuccess(ip);

  // Housekeeping: rimuove le sessioni scadute di tutti gli utenti. Await
  // deliberato (vedi deleteExpiredSessions): login raro, errori visibili.
  await deleteExpiredSessions(db);

  const profs = await listProfilesForUser(db, user.id);
  if (profs.length === 0) throw new HttpError(500, 'NO_PROFILE', 'User has no profile');
  const first = profs[0]!;
  const session = await createSession(db, user.id, first.id);
  setCookie(c, SESSION_COOKIE, session.id, sessionCookieOptions());

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
