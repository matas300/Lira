import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getDb } from './db/client';
import { healthRoute } from './routes/health';
import { authRoute, initAuthRoute } from './routes/auth';
import { profilesRoute } from './routes/profiles';
import { yearSettingsRoute } from './routes/year-settings';
import { pagamentiRoute } from './routes/pagamenti';
import { clientiRoute } from './routes/clienti';
import { fattureRoute } from './routes/fatture';
import { scadenziarioRoute } from './routes/scadenziario';
import { taxRoute } from './routes/tax';
import { calendarioRoute } from './routes/calendario';
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
app.route('/api/year-settings', yearSettingsRoute);
app.route('/api/pagamenti', pagamentiRoute);
app.route('/api/clienti', clientiRoute);
app.route('/api/fatture', fattureRoute);
app.route('/api/scadenziario', scadenziarioRoute);
app.route('/api/tax', taxRoute);
app.route('/api/calendario', calendarioRoute);

// ── Static SPA (prod) ────────────────────────────────────────────────────────
// In produzione il client buildato vive in ./dist/client (relativo alla cwd,
// cioè /app nel container). In dev la dir può non esistere: il client gira su
// Vite (5173) con proxy /api, quindi qui non serviamo nulla.
const clientDir = './dist/client';
if (existsSync(`${clientDir}/index.html`)) {
  const assets = serveStatic({ root: clientDir });
  const spaFallback = serveStatic({ path: `${clientDir}/index.html` });
  app.use('*', (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    return assets(c, next);
  });
  app.get('*', (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    return spaFallback(c, next);
  });
}

const port = Number(process.env.PORT ?? 8787);

await initAuthRoute(); // eager dummy hash pre-compute (timing attack mitigation)
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`Lira server listening on http://localhost:${port}`);
});
