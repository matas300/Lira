import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(url: string, authToken?: string): { db: Db; client: Client } {
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { db, client };
}

let cached: { db: Db; client: Client } | undefined;

export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL ?? 'file:./local.db';
    const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
    cached = createDb(url, authToken);
  }
  return cached.db;
}
