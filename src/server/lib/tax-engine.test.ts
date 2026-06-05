// src/server/lib/tax-engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAccontoPlan } from './tax-engine';

test('buildAccontoPlan: importo 0 → mode none', () => {
  const p = buildAccontoPlan(0);
  assert.equal(p.mode, 'none');
  assert.equal(p.total, 0);
  assert.equal(p.first, 0);
  assert.equal(p.second, 0);
});

test('buildAccontoPlan: M3 boundary 51.64 → mode none', () => {
  assert.equal(buildAccontoPlan(51.64).mode, 'none');
});

test('buildAccontoPlan: M3 boundary esatto 51.65 → mode none (≤)', () => {
  assert.equal(buildAccontoPlan(51.65).mode, 'none');
});

test('buildAccontoPlan: M3 boundary 51.66 → mode single', () => {
  const p = buildAccontoPlan(51.66);
  assert.equal(p.mode, 'single');
  assert.equal(p.first, 0);
  assert.equal(p.second, 51.66);
});

test('buildAccontoPlan: M3 boundary esatto 257.52 → mode single', () => {
  const p = buildAccontoPlan(257.52);
  assert.equal(p.mode, 'single');
  assert.equal(p.second, 257.52);
});

test('buildAccontoPlan: M3 boundary 257.53 → mode double 40/60 con somma = 257.53', () => {
  const p = buildAccontoPlan(257.53);
  assert.equal(p.mode, 'double');
  assert.ok(p.first > 103 && p.first < 104);
  assert.ok(p.second > 154 && p.second < 155);
  assert.equal(Math.round((p.first + p.second) * 100) / 100, 257.53);
});
