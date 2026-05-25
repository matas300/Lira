// src/client/components/bottom-nav.ts
export function renderBottomNav(): string {
  return `
    <nav class="bottom-nav">
      <a class="tab" aria-disabled="true">📄 Fatture</a>
      <a class="tab" aria-disabled="true">⏳ Scadenze</a>
      <a class="tab" aria-disabled="true">📊 Dichiarazione</a>
    </nav>
  `;
}
