import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
import type { UsageDatabase, UsagePreparedStatement } from '../src/infra/usage-recorder.ts';

const assets = { fetch: async () => new Response('asset') };
const base = { ASSETS: assets, LOG_LEVEL: 'silent' };

function scripted(results: Record<string, unknown>[][]) {
  let batches = 0;
  const statement = (): UsagePreparedStatement => ({
    bind() { return statement(); },
    async all() { return { results: [] }; },
    async first() { return null; },
  });
  const db: UsageDatabase = {
    prepare: () => statement(),
    async batch(statements) {
      batches += 1;
      assert.equal(statements.length, 3);
      return results.map(rows => ({ results: rows }));
    },
  };
  return { db, batches: () => batches };
}

describe('Given the Workers stats route', () => {
  it('When D1 is absent Then returns an empty 200 and does not serve the asset', async () => {
    let assetsCalled = 0;
    const response = await worker.fetch(new Request('https://ai-ps.test/api/stats'), {
      ...base, ASSETS: { fetch: async () => { assetsCalled += 1; return new Response('asset'); } },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'max-age=60');
    assert.deepEqual(await response.json(), { days: 7, totals: { calls: 0, errors: 0, costUsd: 0, inputTokens: 0, cachedTokens: 0 }, byService: [], byDay: [] });
    assert.equal(assetsCalled, 0);
  });

  it('When USAGE_DB returns grouped rows Then the response is that aggregate from one batch', async () => {
    const store = scripted([
      [{ calls: 2, errors: 1, costUsd: 0.25, inputTokens: 5_000, cachedTokens: 2_500 }],
      [{ service: 'brave', calls: 2, errors: 1, avgMs: 12, costUsd: 0.25 }],
      [{ day: '2026-11-19', service: 'brave', calls: 2, costUsd: 0.25 }],
    ]);
    const response = await worker.fetch(new Request('https://ai-ps.test/api/stats?days=1'), { ...base, USAGE_DB: store.db });
    assert.equal(response.status, 200);
    assert.equal(store.batches(), 1);
    assert.deepEqual(await response.json(), {
      days: 1,
      totals: { calls: 2, errors: 1, costUsd: 0.25, inputTokens: 5_000, cachedTokens: 2_500 },
      byService: [{ service: 'brave', calls: 2, errors: 1, avgMs: 12, costUsd: 0.25 }],
      byDay: [{ day: '2026-11-19', service: 'brave', calls: 2, costUsd: 0.25 }],
    });
  });

  it('When days or the method is rejected Then D1 is not queried', async () => {
    const store = scripted([]);
    const bad = await worker.fetch(new Request('https://ai-ps.test/api/stats?days=0'), { ...base, USAGE_DB: store.db });
    const method = await worker.fetch(new Request('https://ai-ps.test/api/stats', { method: 'POST' }), { ...base, USAGE_DB: store.db });
    assert.equal(bad.status, 400);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('Allow'), 'GET');
    assert.equal(store.batches(), 0);
  });
});
