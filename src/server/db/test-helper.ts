// src/server/db/test-helper.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, type Db } from './client';
import type { Client } from '@libsql/client';

const _tempDirsToCleanup: Array<{ dir: string; client: Client }> = [];
process.on('exit', () => {
  for (const { dir, client } of _tempDirsToCleanup) {
    try { client.close(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// NB: usiamo un file temporaneo per ogni test DB perché :memory: con libSQL
// resetta la connessione dopo db.transaction() (this.#db = null nel client sqlite3).
// Con file temporaneo, ogni createTestDb() è isolato e le transazioni funzionano.
export async function createTestDb(): Promise<{ db: Db; client: Client }> {
  const dir = mkdtempSync(join(tmpdir(), 'lira-test-'));
  const dbPath = join(dir, `${randomUUID()}.db`);
  const url = `file:${dbPath}`;
  const { db, client } = createDb(url);
  await migrate(db, { migrationsFolder: './drizzle' });
  _tempDirsToCleanup.push({ dir, client });
  return { db, client };
}
