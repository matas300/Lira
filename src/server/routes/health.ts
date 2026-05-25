import { Hono } from 'hono';

export const healthRoute = new Hono();
healthRoute.get('/', (c) => c.json({ ok: true as const, version: '0.1.0' }));
