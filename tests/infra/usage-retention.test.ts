import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { USAGE_RETENTION_DAYS } from '../../src/domain/usage.ts';
import { pruneUsageEvents, USAGE_RETENTION_MS } from '../../src/infra/usage-retention.ts';
import type { UsageDatabase, UsagePreparedStatement } from '../../src/infra/usage-recorder.ts';

function database() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const pending = new Map<UsagePreparedStatement, { sql: string; values: unknown[] }>();
  const db: UsageDatabase = {
    prepare(sql) {
      const statement: UsagePreparedStatement = {
        bind(...values) { pending.set(statement, { sql, values }); return statement; },
        all: async () => ({ results: [] }),
        first: async () => null,
      };
      return statement;
    },
    async batch(statements) {
      for (const statement of statements) calls.push(pending.get(statement)!);
    },
  };
  return { db, calls };
}

describe('Given stored usage metrics', () => {
  it('When the daily cron prunes Then deletes rows older than 35 days', async () => {
    assert.equal(USAGE_RETENTION_DAYS, 35);
    assert.equal(USAGE_RETENTION_MS, 35 * 24 * 60 * 60 * 1000);
    const now = Date.UTC(2026, 10, 19);
    const { db, calls } = database();
    await pruneUsageEvents(db, now);
    assert.deepEqual(calls, [{ sql: 'DELETE FROM usage_events WHERE ts < ?', values: [now - USAGE_RETENTION_MS] }]);
  });

  it('When no database is configured Then pruning does nothing', async () => {
    await pruneUsageEvents(undefined, Date.now());
  });
});

describe('Given the usage retention migration', () => {
  it('When migration 0003 is present Then it keeps the timestamp index the cron delete uses', () => {
    const sql = readFileSync(new URL('../../migrations/0003_usage_retention.sql', import.meta.url), 'utf8');
    assert.match(sql, /CREATE INDEX IF NOT EXISTS usage_events_ts ON usage_events\(ts\)/);
    assert.match(sql, /35일/);
  });
});
