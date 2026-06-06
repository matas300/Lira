// src/client/lib/clienti-api.ts
import { api } from './api';
import type { ClientePublic, ClienteCreateInput, ClienteUpdateInput, PivaLookupData } from '@shared/types';

export function listClienti(): Promise<ClientePublic[]> {
  return api.get<ClientePublic[]>('/api/clienti');
}

export function createCliente(input: ClienteCreateInput): Promise<ClientePublic> {
  return api.post<ClientePublic>('/api/clienti', input);
}

export function updateCliente(id: string, input: ClienteUpdateInput): Promise<ClientePublic> {
  return api.patch<ClientePublic>(`/api/clienti/${id}`, input);
}

export function removeCliente(id: string): Promise<{ ok: true }> {
  return api.del<{ ok: true }>(`/api/clienti/${id}`);
}

export function setDefault(id: string): Promise<ClientePublic> {
  return api.patch<ClientePublic>(`/api/clienti/${id}`, { isDefault: true });
}

export function lookupPiva(piva: string): Promise<{ data: PivaLookupData }> {
  return api.get<{ data: PivaLookupData }>(`/api/clienti/lookup/${encodeURIComponent(piva)}`);
}
