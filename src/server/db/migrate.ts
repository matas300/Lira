import { migrate } from 'drizzle-orm/libsql/migrator';
import { getDb } from './client.js';

async function main() {
  const db = getDb();
  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
