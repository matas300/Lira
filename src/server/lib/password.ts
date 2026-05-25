// src/server/lib/password.ts
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, {
    // memoryCost in KiB. 64 MiB è il default sicuro raccomandato OWASP.
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
