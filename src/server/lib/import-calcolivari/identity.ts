import { createHash, randomUUID } from 'node:crypto';

/**
 * Id deterministico da una firma naturale: SHA-256 dei `parts` formattato
 * come UUID. Stessi input → stesso id → import idempotente. null/undefined
 * normalizzati a stringa vuota.
 */
export function det(...parts: Array<string | number | null | undefined>): string {
  const hex = createHash('sha256')
    .update(parts.map((p) => (p ?? '').toString()).join('|'))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function newId(): string {
  return randomUUID();
}
