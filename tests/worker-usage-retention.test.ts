import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { type Env } from '../src/worker.ts';
import { USAGE_RETENTION_DAYS } from '../src/domain/usage.ts';
import { USAGE_RETENTION_MS, type UsageDatabase } from '../src/infra/usage-retention.ts';

function environment(extra: Partial<Env> = {}): Env {
  return { ASSETS: { fetch: async () => new Response('asset') }, LOG_LEVEL: 'silent', ...extra };
}

function recordingDatabase() {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) { statement.values = bound; return statement; },
        all: async () => ({ results: [] as Record<string, unknown>[] }),
        first: async () => null,
        sql,
        values,
      };
      return statement;
    },
    async batch(statements: Array<{ sql: string; values: unknown[] }>) {
      for (const statement of statements) calls.push({ sql: statement.sql, values: statement.values });
    },
  } as unknown as UsageDatabase;
  return { db, calls };
}

describe('Given usage retention runs on the daily cron', () => {
  it('When the scheduled handler runs Then deletes rows older than 35 days exactly once', async t => {
    const now = Date.UTC(2026, 10, 19);
    t.mock.method(Date, 'now', () => now);
    const { db, calls } = recordingDatabase();
    await worker.scheduled({}, environment({ USAGE_DB: db }));
    assert.deepEqual(calls, [{ sql: 'DELETE FROM usage_events WHERE ts < ?', values: [now - USAGE_RETENTION_MS] }]);
    assert.equal(USAGE_RETENTION_DAYS, 35);
  });

  it('When a normal request finishes Then does not run the retention delete', async () => {
    const { db, calls } = recordingDatabase();
    const response = await worker.fetch(new Request('https://ai-ps.test/api/unknown'), environment({ USAGE_DB: db }));
    assert.equal(response.status, 404);
    assert.deepEqual(calls, []);
  });
});

describe('Given the production log and cron configuration', () => {
  it('When reading wrangler.jsonc Then invocation logs are off, the cron is daily and stats stay within retention', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    assert.equal(config.observability.enabled, true);
    assert.equal(config.observability.logs.invocation_logs, false);
    assert.deepEqual(config.triggers.crons, ['17 3 * * *']);
    assert.ok(30 <= USAGE_RETENTION_DAYS);
  });
});
