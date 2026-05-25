import { getDb } from '../src/server/db/client';
import { createProfileForUser } from '../src/server/lib/users';

async function main() {
  const [, , email, slug, ...nameParts] = process.argv;
  const displayName = nameParts.join(' ');
  if (!email || !slug || !displayName) {
    console.error('Usage: npm run create-profile -- <email> <slug> <displayName>');
    process.exit(1);
  }
  try {
    const p = await createProfileForUser(getDb(), email, slug, displayName);
    console.log(`Profile created: ${p.id} (${p.slug})`);
    process.exit(0);
  } catch (err: any) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      console.error(`Slug "${slug}" già in uso per ${email}.`);
      process.exit(2);
    }
    console.error('Errore:', err?.message ?? err);
    process.exit(1);
  }
}

main();
