// src/client/main.ts
import { getMe } from './lib/auth';
import { applyTheme } from './lib/theme';

type PageModule = { mount: (container: HTMLElement) => () => void };

const routes: Record<string, () => Promise<PageModule>> = {
  '/login': () => import('./pages/login'),
  '/profiles': () => import('./pages/profiles'),
  '/clienti': () => import('./pages/clienti'),
  '/fatture': () => import('./pages/fatture'),
  '/': () => import('./pages/regime'),
  '/tasse': () => import('./pages/tasse'),
  // non ancora implementate → placeholder condiviso
  '/scadenze': () => import('./pages/scadenze'),
  '/calendario': () => import('./pages/calendario'),
  '/budget': () => import('./pages/budget'),
  '/dichiarazione': () => import('./pages/dichiarazione'),
  '/impostazioni': () => import('./pages/impostazioni'),
  '/riepilogo': () => import('./pages/riepilogo'),
  '/profilo-personale': () => import('./pages/profilo-personale'),
  '/profilo-piva': () => import('./pages/profilo-piva'),
};

const PUBLIC_ROUTES = new Set(['/login']);

const appEl = document.getElementById('app') as HTMLElement;
let unmount: (() => void) | null = null;

async function navigate(pathname: string, push = true) {
  const routeFn = routes[pathname] ?? routes['/'];
  if (!routeFn) return;
  if (push && pathname !== location.pathname) {
    history.pushState({}, '', pathname);
  }
  const requiresAuth = !PUBLIC_ROUTES.has(pathname);

  if (requiresAuth) {
    const me = await getMe();
    if (!me) return navigate('/login', false);
  }

  if (unmount) unmount();
  appEl.innerHTML = '';
  const mod = await routeFn();
  unmount = mod.mount(appEl);
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  // Guard: elementi interattivi (select/input/...) dentro un [data-route]
  // gestiscono il proprio click — non devono far navigare via.
  const interactive = target.closest<HTMLElement>('select, input, textarea, label, button:not([data-route])');
  const link = target.closest<HTMLElement>('[data-route]');
  if (!link) return;
  if (interactive && link.contains(interactive)) return;
  const path = link.dataset.route!;
  e.preventDefault();
  navigate(path);
});

window.addEventListener('popstate', () => navigate(location.pathname, false));

applyTheme();
navigate(location.pathname, false);
