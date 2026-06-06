import { test } from 'node:test';
import assert from 'node:assert/strict';
import { det, newId } from './identity';

test('det: deterministico e stabile per stessi input', () => {
  const a = det('pagamento', 'p1', '2025-06-30', 1000, 'tasse', null);
  const b = det('pagamento', 'p1', '2025-06-30', 1000, 'tasse', null);
  assert.equal(a, b);
});

test('det: cambia se cambia un input', () => {
  assert.notEqual(det('p1', 1000), det('p1', 1001));
});

test('det: formato UUID-shaped (8-4-4-4-12 hex)', () => {
  assert.match(det('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('det: null/undefined trattati come stringa vuota (stesso hash)', () => {
  assert.equal(det('a', null, 'b'), det('a', undefined, 'b'));
});

test('newId: UUID v4 unico', () => {
  assert.notEqual(newId(), newId());
  assert.match(newId(), /^[0-9a-f-]{36}$/);
});
