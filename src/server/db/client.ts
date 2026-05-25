import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(url: string, authToken?: string): { db: Db; client: Client } {
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { db, client };
}

let cached: { db: Db; client: Client } | undefined;

export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL not set. Copia .env.example in .env e configura.');
    }
    const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
    cached = createDb(url, authToken);
  }
  return cached.db;
}

export function closeDb(): void {
  if (cached) {
    cached.client.close();
    cached = undefined;
  }
}
