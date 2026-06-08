// src/client/components/bottom-nav.ts
export function renderBottomNav(): string {
  return `
    <nav class="bottom-nav">
      <a class="tab" data-route="/clienti" href="/clienti">👥 Clienti</a>
      <a class="tab" data-route="/fatture" href="/fatture">📄 Fatture</a>
      <a class="tab" aria-disabled="true">⏳ Scadenze</a>
      <a class="tab" aria-disabled="true">📊 Dichiarazione</a>
    </nav>
  `;
}
