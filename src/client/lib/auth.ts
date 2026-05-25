// src/client/lib/auth.ts
// Stub — will be fully implemented in T20 (api.ts + auth.ts)

export type MeResponse = {
  user: { id: string; email: string; name: string };
  profiles: Array<{ id: string; slug: string; displayName: string; giorniIncasso: number }>;
  activeProfile: { id: string; slug: string; displayName: string; giorniIncasso: number };
};

export async function getMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.status === 401) return null;
    return res.json() as Promise<MeResponse>;
  } catch {
    return null;
  }
}
