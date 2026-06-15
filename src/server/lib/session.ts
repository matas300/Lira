// src/server/lib/session.ts
import { randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Throttle del rolling refresh: rinnoviamo expires_at (+ cookie) al massimo
// una volta ogni 24h, non a ogni richiesta — evita un UPDATE su Turso per
// ogni chiamata autenticata. Nessuna colonna nuova: l'"età" dell'ultimo
// refresh si deduce da expiresAt (refresh ⇔ expiresAt − now < TTL − 24h).
export const SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SessionRow = typeof sessions.$inferSelect;

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function isoNow(): string {
  return new Date().toISOString();
}

export async function createSession(db: Db, userId: string, activeProfileId: string): Promise<SessionRow> {
  const row: SessionRow = {
    id: randomUUID(),
    userId,
    activeProfileId,
    expiresAt: isoIn(SESSION_TTL_MS),
    createdAt: isoNow(),
    lastUsedAt: isoNow(),
  };
  await db.insert(sessions).values(row);
  return row;
}

export async function getSession(db: Db, id: string): Promise<SessionRow | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  return row;
}

// true se l'ultimo refresh risale a più di SESSION_REFRESH_INTERVAL_MS fa,
// cioè se expiresAt è "scivolato" sotto TTL − 24h rispetto a now.
export function needsRefresh(session: Pick<SessionRow, 'expiresAt'>, nowMs = Date.now()): boolean {
  return new Date(session.expiresAt).getTime() - nowMs < SESSION_TTL_MS - SESSION_REFRESH_INTERVAL_MS;
}

export async function refreshSession(db: Db, id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastUsedAt: isoNow(), expiresAt: isoIn(SESSION_TTL_MS) })
    .where(eq(sessions.id, id));
}

// Pulizia sessioni scadute (oltre alla lazy-delete in getSession). Chiamata
// al login: await esplicito — è un'operazione rara (3 utenti) e così un
// errore DB emerge subito invece di perdersi in un fire-and-forget.
export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, isoNow()));
}

export async function setActiveProfile(db: Db, id: string, profileId: string): Promise<void> {
  await db.update(sessions).set({ activeProfileId: profileId }).where(eq(sessions.id, id));
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
