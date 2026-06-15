// src/client/main.ts
import { getMe } from './lib/auth';

type PageModule = { mount: (container: HTMLElement) => () => void };

const routes: Record<string, () => Promise<PageModule>> = {
  // @ts-ignore — pages/login.ts created in T21
  '/login': () => import('./pages/login'),
  // @ts-ignore — pages/dashboard.ts created in T22
  '/': () => import('./pages/dashboard'),
  // @ts-ignore — pages/profiles.ts created in T23
  '/profiles': () => import('./pages/profiles'),
  // @ts-ignore — pages/clienti.ts created in Slice 4A
  '/clienti': () => import('./pages/clienti'),
  // @ts-ignore — pages/fatture.ts created in Slice 5A
  '/fatture': () => import('./pages/fatture'),
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

navigate(location.pathname, false);
