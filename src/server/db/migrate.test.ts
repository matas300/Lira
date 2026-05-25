// src/server/db/migrate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-helper.js';

test('migrations creano tutte le tabelle attese', async () => {
  const { client } = await createTestDb();
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  const tables = result.rows.map((r) => r['name'] as string);
  for (const expected of [
    'budget_items',
    'calendar_entries',
    'clienti',
    'dichiarazioni',
    'fatture',
    'pagamenti',
    'profiles',
    'sessions',
    'spese',
    'users',
    'year_settings',
  ]) {
    assert.ok(tables.includes(expected), `Manca tabella: ${expected}`);
  }
});

test('users ha colonna email UNIQUE', async () => {
  const { client } = await createTestDb();
  await client.execute({
    sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
    args: ['u1', 'a@b.it', 'hash', 'A'],
  });
  await assert.rejects(
    () => client.execute({
      sql: `INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)`,
      args: ['u2', 'a@b.it', 'hash', 'B'],
    }),
    /UNIQUE/,
  );
});
