// src/client/lib/api.ts
import type { ErrorEnvelope } from '@shared/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    // Risposta non-JSON (es. 502 HTML da un proxy): non lasciar trapelare un
    // SyntaxError opaco — normalizza in ApiError.
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'INVALID_RESPONSE', `Risposta non valida dal server (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    // Sessione scaduta/mancante fuori dal flusso auth → torna al login.
    // (/api/auth/* gestisce i propri 401: getMe() li usa per capire "non loggato".)
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    const env = json as ErrorEnvelope | null;
    throw new ApiError(
      res.status,
      env?.error?.code ?? 'HTTP_ERROR',
      env?.error?.message ?? `HTTP ${res.status}`,
      env?.error?.details,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
