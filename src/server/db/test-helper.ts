// src/server/db/test-helper.ts
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, type Db } from './client.js';
import type { Client } from '@libsql/client';

export async function createTestDb(): Promise<{ db: Db; client: Client }> {
  // file::memory:?cache=shared è importante perché ogni connection diversa vede lo stesso DB
  // Ma per test isolati basta `:memory:`
  const { db, client } = createDb(':memory:');
  await migrate(db, { migrationsFolder: './drizzle' });
  return { db, client };
}
