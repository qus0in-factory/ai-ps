import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpStats } from '../../src/infra/http-stats.ts';
import type { StatsClient } from '../../src/ui/pages/stats-view.ts';

const stats = {
  days: 7,
  totals: { calls: 3, errors: 1, costUsd: 0.0123 },
  byService: [{ service: 'openai' as const, calls: 3, errors: 1, avgMs: 420.5, costUsd: 0.0123 }],
  byDay: [{ day: '2026-11-19', service: 'openai' as const, calls: 3, costUsd: 0.0123 }],
};

describe('Given the stats HTTP client', () => {
  it('When requested Then GETs /api/stats with days and returns the validated stats', async () => {
    const requests: { path: string; init?: RequestInit }[] = [];
    const client: StatsClient = createHttpStats(async (path, init) => {
      requests.push({ path: String(path), init });
      return Response.json(stats);
    });
    assert.deepEqual(await client.get(14), { ok: true, value: stats });
    assert.equal(requests[0]!.path, '/api/stats?days=14');
    assert.equal(requests[0]!.init?.method ?? 'GET', 'GET');
  });

  it('When days is omitted Then defaults to 7', async () => {
    let path = '';
    await createHttpStats(async (input) => { path = String(input); return Response.json(stats); }).get();
    assert.equal(path, '/api/stats?days=7');
  });

  it('When the server fails or the shape is wrong Then returns a Korean reason without throwing', async () => {
    const failing = createHttpStats(async () => new Response('{}', { status: 500 }));
    assert.equal((await failing.get()).ok, false);
    const bad = createHttpStats(async () => Response.json({ ...stats, byService: [{ service: 'x' }] }));
    const outcome = await bad.get();
    assert.equal(outcome.ok, false);
    const down = createHttpStats(async () => { throw new TypeError('network'); });
    assert.equal((await down.get()).ok, false);
  });

  it('When days is out of 1..30 Then rejects before any network call', async () => {
    let called = 0;
    const client = createHttpStats(async () => { called++; return Response.json(stats); });
    for (const days of [0, 31, 1.5]) assert.equal((await client.get(days)).ok, false);
    assert.equal(called, 0);
  });
});
