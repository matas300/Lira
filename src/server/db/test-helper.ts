// src/server/db/test-helper.ts
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, type Db } from './client';
import type { Client } from '@libsql/client';

// NB: usiamo un file temporaneo per ogni test DB perché :memory: con libSQL
// resetta la connessione dopo db.transaction() (this.#db = null nel client sqlite3).
// Con file temporaneo, ogni createTestDb() è isolato e le transazioni funzionano.
export async function createTestDb(): Promise<{ db: Db; client: Client }> {
  const dir = mkdtempSync(join(tmpdir(), 'lira-test-'));
  const dbPath = join(dir, `${randomUUID()}.db`);
  const url = `file:${dbPath}`;
  const { db, client } = createDb(url);
  await migrate(db, { migrationsFolder: './drizzle' });
  return { db, client };
}
