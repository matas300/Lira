// src/client/lib/fatture-api.ts
import { api } from './api';
import type { FatturaPublic, FatturaCreateInput, FatturaUpdateInput } from '@shared/types';

export function listFatture(stato?: string): Promise<FatturaPublic[]> {
  const q = stato ? `?stato=${encodeURIComponent(stato)}` : '';
  return api.get<FatturaPublic[]>(`/api/fatture${q}`);
}

export function getFattura(id: string): Promise<FatturaPublic> {
  return api.get<FatturaPublic>(`/api/fatture/${id}`);
}

export function createFattura(input: FatturaCreateInput): Promise<FatturaPublic> {
  return api.post<FatturaPublic>('/api/fatture', input);
}

export function updateFattura(id: string, input: FatturaUpdateInput): Promise<FatturaPublic> {
  return api.patch<FatturaPublic>(`/api/fatture/${id}`, input);
}

export function removeFattura(id: string): Promise<{ ok: true }> {
  return api.del<{ ok: true }>(`/api/fatture/${id}`);
}

export function inviaFattura(id: string): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${id}/invia`, {});
}

export function pagaFattura(id: string, date?: string): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${id}/paga`, date ? { date } : {});
}

export function annullaPagamento(id: string): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${id}/annulla-pagamento`, {});
}
