// src/server/lib/piva-lookup.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupPartitaIva } from './piva-lookup';

const PIVA = '00743110157';

function fakeFetch(status: number, json: unknown): typeof fetch {
  return (async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => json,
  })) as unknown as typeof fetch;
}

test('lookup ok — normalizza risposta data[] (alias array)', async () => {
  const r = await lookupPartitaIva(PIVA, {
    apiKey: 'k',
    fetchImpl: fakeFetch(200, {
      success: true,
      data: [{
        companyName: 'ACME SRL', taxCode: 'RSSMRA80A01H501U',
        address: { registeredOffice: { streetName: 'VIA MILANO 150', zipCode: '20100', town: 'MILANO', province: 'mi' } },
        pec: 'acme@pec.it', sdiCode: 'ufxxxx',
      }],
    }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.data?.nome, 'ACME SRL');
  assert.equal(r.data?.codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(r.data?.indirizzo, 'VIA MILANO 150');
  assert.equal(r.data?.cap, '20100');
  assert.equal(r.data?.citta, 'MILANO');
  assert.equal(r.data?.provincia, 'MI');
  assert.equal(r.data?.pec, 'acme@pec.it');
  assert.equal(r.data?.codiceSdi, 'UFXXXX');
});

test('lookup ok — risposta data come oggetto (non array)', async () => {
  const r = await lookupPartitaIva(PIVA, {
    apiKey: 'k',
    fetchImpl: fakeFetch(200, { data: { denominazione: 'Beta', codice_fiscale: 'X' } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.data?.nome, 'Beta');
});

test('lookup 404 → NOT_FOUND', async () => {
  const r = await lookupPartitaIva(PIVA, { apiKey: 'k', fetchImpl: fakeFetch(404, {}) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_FOUND');
});

test('lookup throw → NETWORK', async () => {
  const throwing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  const r = await lookupPartitaIva(PIVA, { apiKey: 'k', fetchImpl: throwing });
  assert.equal(r.code, 'NETWORK');
});

test('lookup senza apiKey → NO_KEY', async () => {
  const r = await lookupPartitaIva(PIVA, {});
  assert.equal(r.code, 'NO_KEY');
});

test('lookup piva invalida → INVALID_PIVA (prima di toccare la rete)', async () => {
  const r = await lookupPartitaIva('123', { apiKey: 'k' });
  assert.equal(r.code, 'INVALID_PIVA');
});
