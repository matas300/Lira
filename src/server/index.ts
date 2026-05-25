import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getDb } from './db/client';
import { healthRoute } from './routes/health';
import { authRoute, initAuthRoute } from './routes/auth';
import { profilesRoute } from './routes/profiles';
import { errorHandler } from './middleware/error';
import type { AuthEnv } from './middleware/auth';

const app = new Hono<AuthEnv>();

app.use('*', logger());
app.use('*', async (c, next) => {
  c.set('db', getDb());
  await next();
});
app.onError(errorHandler);

app.route('/api/health', healthRoute);
app.route('/api/auth', authRoute);
app.route('/api/profiles', profilesRoute);

const port = Number(process.env.PORT ?? 8787);

await initAuthRoute(); // eager dummy hash pre-compute (timing attack mitigation)
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`Lira server listening on http://localhost:${port}`);
});
