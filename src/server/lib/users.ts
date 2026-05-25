// src/server/lib/users.ts
import { randomUUID } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, profiles } from '../db/schema';
import { hashPassword } from './password';
import { deleteAllSessionsForUser } from './session';

export async function findUserByEmail(db: Db, emailLower: string) {
  const [u] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
  return u ?? null;
}

export async function listProfilesForUser(db: Db, userId: string) {
  return db.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(asc(profiles.createdAt));
}

export async function createUserWithDefaultProfile(params: {
  db: Db;
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string; profileId: string }> {
  const emailLower = params.email.toLowerCase().trim();
  const passwordHash = await hashPassword(params.password);
  const userId = randomUUID();
  const profileId = randomUUID();

  await params.db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: emailLower,
      passwordHash,
      name: params.name,
    });
    await tx.insert(profiles).values({
      id: profileId,
      userId,
      slug: 'default',
      displayName: params.name,
    });
  });

  return { userId, profileId };
}

export async function resetPassword(db: Db, email: string, newPassword: string): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  const user = await findUserByEmail(db, emailLower);
  if (!user) throw new Error(`User not found: ${emailLower}`);
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  await deleteAllSessionsForUser(db, user.id);
}
