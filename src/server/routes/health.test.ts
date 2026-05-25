import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { healthRoute } from './health';

test('GET /api/health → 200 { ok:true, version }', async () => {
  const app = new Hono();
  app.route('/api/health', healthRoute);
  const res = await app.request('/api/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');
});
