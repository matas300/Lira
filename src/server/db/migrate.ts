import { migrate } from 'drizzle-orm/libsql/migrator';
import { getDb, closeDb } from './client';

async function main() {
  const db = getDb();
  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  closeDb();
  process.exit(1);
});
