// src/server/middleware/error.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { errorHandler, HttpError } from './error';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/throw', () => { throw new HttpError(418, 'I_AM_TEAPOT', 'short and stout'); });
  app.get('/unknown', () => { throw new Error('boom'); });
  return app;
}

test('HttpError mappato a JSON envelope', async () => {
  const res = await makeApp().request('/throw');
  assert.equal(res.status, 418);
  const body = await res.json();
  assert.deepEqual(body, { error: { code: 'I_AM_TEAPOT', message: 'short and stout' } });
});

test('Errori generici → 500 con code INTERNAL', async () => {
  const res = await makeApp().request('/unknown');
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error.code, 'INTERNAL');
});
