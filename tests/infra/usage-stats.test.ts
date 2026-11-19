import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { queryUsageStats } from '../../src/infra/usage-stats.ts';
import type { UsageDatabase, UsagePreparedStatement } from '../../src/infra/usage-recorder.ts';

const SCHEMA = `CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, route TEXT NOT NULL, service TEXT NOT NULL, op TEXT NOT NULL,
  model TEXT, status INTEGER NOT NULL, ms INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
  cached_tokens INTEGER, cost_usd REAL NOT NULL DEFAULT 0)`;

function openDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  const sql: string[] = [];
  let batches = 0;
  const insert = sqlite.prepare('INSERT INTO usage_events (ts, route, service, op, model, status, ms, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const db: UsageDatabase = {
    prepare(query: string): UsagePreparedStatement {
      return {
        bind(...values: unknown[]) {
          const bound: UsagePreparedStatement = {
            bind: () => bound,
            all: async () => ({ results: [] }),
            first: async () => null,
          };
          Object.assign(bound, { query, values });
          return bound;
        },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
    },
    async batch(statements) {
      batches += 1;
      return statements.map(statement => {
        const bound = statement as UsagePreparedStatement & { query: string; values: unknown[] };
        sql.push(bound.query);
        const results = sqlite.prepare(bound.query).all(...bound.values as (string | number | null)[]);
        return { results };
      });
    },
  };
  return {
    db,
    sql: () => sql,
    batches: () => batches,
    add(ts: number, service: string, status: number, ms: number, cost: number, route = '/api/research', inputTokens: number | null = null, cachedTokens: number | null = null) {
      insert.run(ts, route, service, 'search', null, status, ms, inputTokens, null, cachedTokens, cost);
    },
  };
}

const noon = Date.UTC(2026, 10, 19, 12);
const day = 86_400_000;

describe('Given usage events in D1', () => {
  it('When the window is the last 7 UTC days Then one batch aggregates calls, errors, latency and cost and omits empty days', async () => {
    const store = openDb();
    const start = Date.UTC(2026, 10, 13);
    store.add(start, 'openai', 200, 10, 1);
    store.add(start - 1, 'openai', 200, 999, 9);
    store.add(noon, 'openai', 500, 30, 2);
    store.add(noon + 1, 'openai', 200, 1, 4);
    store.add(Date.UTC(2026, 10, 18, 16), 'brave', 0, 40, 0.25);
    store.add(Date.UTC(2026, 10, 19, 1), 'openai', 399, 20, 0, '/api/chat');
    store.add(Date.UTC(2026, 10, 19, 2), 'openai', 400, 0, 0);
    store.add(Date.UTC(2026, 10, 19, 3), 'weather', 200, 5, 7);
    const stats = await queryUsageStats(store.db, { days: 7, now: noon });
    assert.equal(store.batches(), 1);
    assert.equal(store.sql().length, 3);
    assert.equal(store.sql().filter(query => /group by/i.test(query)).length, 2);
    assert.equal(stats.days, 7);
    assert.deepEqual(stats.totals, { calls: 5, errors: 3, costUsd: 3.25, inputTokens: 0, cachedTokens: 0 });
    assert.deepEqual(stats.byService, [
      { service: 'brave', calls: 1, errors: 1, avgMs: 40, costUsd: 0.25 },
      { service: 'openai', calls: 4, errors: 2, avgMs: 15, costUsd: 3 },
    ]);
    assert.deepEqual(stats.byDay, [
      { day: '2026-11-13', service: 'openai', calls: 1, costUsd: 1 },
      { day: '2026-11-18', service: 'brave', calls: 1, costUsd: 0.25 },
      { day: '2026-11-19', service: 'openai', calls: 3, costUsd: 2 },
    ]);
  });

  it('When now crosses UTC midnight Then the window follows the UTC date, including a moment that is already the next local date', async () => {
    for (const [now, included, excluded] of [
      [Date.UTC(2026, 10, 19) - 1, Date.UTC(2026, 10, 18), Date.UTC(2026, 10, 19)],
      [Date.UTC(2026, 10, 19), Date.UTC(2026, 10, 19), Date.UTC(2026, 10, 19) - 1],
      [Date.UTC(2026, 10, 19) + 1, Date.UTC(2026, 10, 19), Date.UTC(2026, 10, 19) - 1],
    ] as const) {
      const store = openDb();
      store.add(included, 'openai', 200, 5, 1);
      store.add(excluded, 'ncp', 200, 5, 1);
      const stats = await queryUsageStats(store.db, { days: 1, now });
      assert.deepEqual(stats.byDay.map(row => row.day), [new Date(included).toISOString().slice(0, 10)]);
      assert.equal(stats.totals.calls, 1);
    }
    const kstEvening = openDb();
    const now = Date.UTC(2026, 10, 19, 0, 30);
    kstEvening.add(Date.UTC(2026, 10, 18, 16), 'brave', 200, 5, 1);
    kstEvening.add(now, 'openai', 200, 5, 1);
    const stats = await queryUsageStats(kstEvening.db, { days: 1, now });
    assert.deepEqual(stats.byDay, [{ day: '2026-11-19', service: 'openai', calls: 1, costUsd: 1 }]);
    assert.equal(Math.floor(now / day) * day, Date.UTC(2026, 10, 19));
  });

  it('When rows carry tokens Then totals include input and cached token sums', async () => {
    const store = openDb();
    store.add(noon, 'openai', 200, 10, 1, '/api/chat', 1000, 600);
    store.add(noon, 'openai', 500, 20, 0, '/api/chat', 3000, 1000);
    const stats = await queryUsageStats(store.db, { days: 7, now: noon });
    assert.deepEqual(stats.totals, { calls: 2, errors: 1, costUsd: 1, inputTokens: 4000, cachedTokens: 1600 });
  });

  it('When D1 is missing Then returns zeros and does not query', async () => {
    const stats = await queryUsageStats(undefined, { days: 3, now: noon });
    assert.deepEqual(stats, { days: 3, totals: { calls: 0, errors: 0, costUsd: 0, inputTokens: 0, cachedTokens: 0 }, byService: [], byDay: [] });
  });

  it('When the batch reports failure Then the query rejects instead of looking empty', async () => {
    const statement: UsagePreparedStatement = {
      bind: () => statement,
      async all() { return { results: [] }; },
      async first() { return null; },
    };
    const db: UsageDatabase = {
      prepare: () => statement,
      async batch() { return [{ success: false }]; },
    };
    await assert.rejects(() => queryUsageStats(db, { days: 7, now: noon }));
  });
});
