import type { RawExport } from './types';
import { ImportError } from './errors';

/** Riconosce export ufficiale vs backup-wrapper e produce una forma uniforme. */
export function detect(input: unknown): RawExport {
  if (input && typeof input === 'object' && 'keys' in input && 'profile' in input) {
    const w = input as { profile: string; keys: Record<string, unknown> };
    const keys: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(w.keys)) {
      keys[k] = typeof v === 'string' ? JSON.parse(v) : v;
    }
    return { profileName: String(w.profile), keys };
  }
  const keys = (input ?? {}) as Record<string, unknown>;
  return { profileName: deriveProfileName(keys), keys };
}

function deriveProfileName(keys: Record<string, unknown>): string {
  for (const k of Object.keys(keys)) {
    const m = /^calcoliPIVA_profile_(.+)$/.exec(k);
    if (m) return m[1]!;
  }
  for (const k of Object.keys(keys)) {
    const m = /^calcoliPIVA_(.+?)_/.exec(k);
    if (m && m[1] !== 'profile') return m[1]!;
  }
  throw new ImportError('PROFILE_NAME_UNDERIVABLE', 'Impossibile derivare il nome profilo dalle chiavi export.');
}
