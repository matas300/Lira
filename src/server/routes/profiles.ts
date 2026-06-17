// src/server/routes/profiles.ts
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { ProfileCreateInput } from '@shared/schemas';
import { profiles } from '../db/schema';
import { requireSession, SESSION_COOKIE, type AuthEnv } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { zJson } from '../middleware/validate';
import { listProfilesForUser } from '../lib/users';
import { setActiveProfile } from '../lib/session';

export const profilesRoute = new Hono<AuthEnv>();

profilesRoute.use('*', requireSession);

function toPublic(p: typeof profiles.$inferSelect) {
  return { id: p.id, slug: p.slug, displayName: p.displayName, giorniIncasso: p.giorniIncasso };
}

function parseBlob(v: string | null): Record<string, unknown> {
  if (!v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toFull(p: typeof profiles.$inferSelect) {
  return {
    id: p.id, slug: p.slug, displayName: p.displayName, giorniIncasso: p.giorniIncasso,
    anagrafica: parseBlob(p.anagrafica), attivita: parseBlob(p.attivita),
  };
}

profilesRoute.get('/', async (c) => {
  const db = c.get('db');
  const list = await listProfilesForUser(db, c.get('userId'));
  return c.json({ profiles: list.map(toPublic) });
});

profilesRoute.get('/active', async (c) => {
  const db = c.get('db');
  const profileId = c.get('activeProfileId');
  const [row] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!row) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profilo attivo non trovato');
  return c.json({ profile: toFull(row) });
});

profilesRoute.post('/', zJson(ProfileCreateInput), async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const { slug, displayName } = c.req.valid('json');
  try {
    const id = randomUUID();
    await db.insert(profiles).values({ id, userId, slug, displayName });
    const [created] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
    return c.json({ profile: toPublic(created!) });
  } catch (err: unknown) {
    if (String((err as { message?: string })?.message ?? '').includes('UNIQUE')) {
      throw new HttpError(409, 'SLUG_EXISTS', `Slug "${slug}" già in uso per questo utente`);
    }
    throw err;
  }
});

profilesRoute.post('/:slug/activate', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const slug = c.req.param('slug');

  const [target] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.userId, userId), eq(profiles.slug, slug)))
    .limit(1);
  if (!target) throw new HttpError(404, 'PROFILE_NOT_FOUND', `Profilo "${slug}" non trovato`);

  const sessionId = getCookie(c, SESSION_COOKIE)!;
  await setActiveProfile(db, sessionId, target.id);

  return c.json({ activeProfile: toPublic(target) });
});
