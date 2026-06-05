import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-helper';

test('migration 0001: yearSettings ha le 3 nuove colonne (audit fixes)', async () => {
  const { client } = await createTestDb();
  const result = await client.execute(`
    SELECT name FROM pragma_table_info('year_settings')
    WHERE name IN ('proroga_saldo_at', 'riduzione_35_comunicata', 'riduzione_35_data_comunicazione')
    ORDER BY name
  `);
  assert.equal(result.rows.length, 3);
  const names = result.rows.map((r) => r['name'] as string);
  assert.deepEqual(names.sort(), [
    'proroga_saldo_at',
    'riduzione_35_comunicata',
    'riduzione_35_data_comunicazione',
  ]);
});
