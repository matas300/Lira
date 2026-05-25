// src/server/lib/session.ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

export async function refreshSession(db: Db, id: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastUsedAt: isoNow(), expiresAt: isoIn(SESSION_TTL_MS) })
    .where(eq(sessions.id, id));
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
