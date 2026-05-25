// src/client/lib/auth.ts
import { api, ApiError } from './api';
import type { LoginInput, MeResponse, ProfileCreateInput, ProfilePublic } from '@shared/types';

export async function getMe(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>('/api/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function login(input: LoginInput): Promise<MeResponse> {
  return api.post<MeResponse>('/api/auth/login', input);
}

export function logout(): Promise<{ ok: true }> {
  return api.post<{ ok: true }>('/api/auth/logout');
}

export function listProfiles(): Promise<{ profiles: ProfilePublic[] }> {
  return api.get<{ profiles: ProfilePublic[] }>('/api/profiles');
}

export function createProfile(input: ProfileCreateInput): Promise<{ profile: ProfilePublic }> {
  return api.post<{ profile: ProfilePublic }>('/api/profiles', input);
}

export function switchProfile(slug: string): Promise<{ activeProfile: ProfilePublic }> {
  return api.post<{ activeProfile: ProfilePublic }>(`/api/profiles/${encodeURIComponent(slug)}/activate`);
}
