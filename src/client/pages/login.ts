// src/client/pages/login.ts
import { login } from '../lib/auth';
import { ApiError } from '../lib/api';

export function mount(container: HTMLElement): () => void {
  container.innerHTML = `
    <main class="app-main" style="display:grid;place-items:center;min-height:100dvh;">
      <form class="card" style="width:100%;max-width:380px;">
        <h1 style="margin-bottom:var(--space-6);">Lira</h1>
        <div class="form-row">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" class="input" required autocomplete="username" />
        </div>
        <div class="form-row">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" class="input" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Accedi</button>
        <p class="form-error" data-error hidden></p>
      </form>
    </main>
  `;

  const form = container.querySelector('form')!;
  const errorEl = container.querySelector<HTMLElement>('[data-error]')!;
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;

  async function onSubmit(e: Event) {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    const fd = new FormData(form);
    try {
      await login({ email: String(fd.get('email')), password: String(fd.get('password')) });
      history.pushState({}, '', '/');
      // forza re-render del router rilanciando navigate via popstate-like:
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Errore inatteso';
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  }

  form.addEventListener('submit', onSubmit);

  return () => form.removeEventListener('submit', onSubmit);
}
