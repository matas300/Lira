import { getDb } from '../src/server/db/client';
import { resetPassword } from '../src/server/lib/users';

async function main() {
  const [, , email, newPassword] = process.argv;
  if (!email || !newPassword) {
    console.error('Usage: npm run reset-password -- <email> <newPassword>');
    process.exit(1);
  }
  try {
    await resetPassword(getDb(), email, newPassword);
    console.log(`Password reset OK per ${email}. Tutte le sessioni invalidate.`);
    process.exit(0);
  } catch (err: any) {
    console.error('Errore:', err?.message ?? err);
    process.exit(2);
  }
}

main();
