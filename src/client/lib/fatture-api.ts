// src/client/lib/fatture-api.ts
import { api, ApiError } from './api';
import type {
  FatturaPublic, FatturaCreateInput, FatturaUpdateInput, NotaCreditoCreateInput,
  ImportFatturaInput, ImportReport,
} from '@shared/types';

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

export function createNotaCredito(fatturaId: string, input: NotaCreditoCreateInput): Promise<FatturaPublic> {
  return api.post<FatturaPublic>(`/api/fatture/${fatturaId}/nota-credito`, input);
}

export function importXmlFatture(items: ImportFatturaInput[]): Promise<ImportReport> {
  return api.post<ImportReport>('/api/fatture/import-xml', { items });
}

/** Scarica l'XML FatturaPA della fattura. Su errore lancia ApiError col messaggio del server. */
export async function downloadFatturaXml(id: string): Promise<void> {
  const res = await fetch(`/api/fatture/${id}/xml`, { credentials: 'include' });
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `HTTP ${res.status}`;
    let details: unknown;
    try {
      const env = await res.json() as { error?: { code?: string; message?: string; details?: unknown } };
      code = env.error?.code ?? code;
      message = env.error?.message ?? message;
      details = env.error?.details;
    } catch { /* corpo non-JSON */ }
    const detailMsg = Array.isArray(details) && details.length ? `: ${(details as string[]).join('; ')}` : '';
    throw new ApiError(res.status, code, message + detailMsg, details);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const filename = m ? m[1]! : `fattura-${id}.xml`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
