import { getDb } from '../src/server/db/client';
import { createUserWithDefaultProfile } from '../src/server/lib/users';

async function main() {
  const [, , email, password, ...nameParts] = process.argv;
  if (!email || !password) {
    console.error('Usage: npm run create-user -- <email> <password> [name]');
    process.exit(1);
  }
  const name = nameParts.join(' ') || email.split('@')[0]!;

  const db = getDb();
  try {
    const { userId, profileId } = await createUserWithDefaultProfile({ db, email, password, name });
    console.log(`User created: ${userId}`);
    console.log(`Default profile: ${profileId}`);
    process.exit(0);
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      console.error(`Email "${email}" già registrata.`);
      process.exit(2);
    }
    console.error('Errore:', err);
    process.exit(1);
  }
}

main();
