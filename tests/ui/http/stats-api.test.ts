import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStatsApi } from '../../../src/ui/http/stats-api.ts';
import type { UsageStats } from '../../../src/domain/usage.ts';

const empty = (days: number): UsageStats => ({ days, totals: { calls: 0, errors: 0, costUsd: 0 }, byService: [], byDay: [] });
const now = 1_763_510_400_000;

function api(load: (days: number, now: number) => Promise<UsageStats> = async days => empty(days)) {
  return createStatsApi({ load, now: () => now });
}

describe('Given the stats HTTP endpoint', () => {
  it('When days is omitted Then loads the default 7 UTC days and caches for 60 seconds', async () => {
    let seen: { days: number; now: number } | undefined;
    const response = await createStatsApi({
      now: () => now,
      load: async (days, clock) => { seen = { days, now: clock }; return empty(days); },
    }).request('/api/stats');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'max-age=60');
    assert.deepEqual(seen, { days: 7, now });
    assert.deepEqual(await response.json(), empty(7));
  });

  it('When days is between 1 and 30 Then that window is loaded', async () => {
    for (const days of [1, 30]) {
      const response = await api().request(`/api/stats?days=${days}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).days, days);
    }
  });

  it('When days is outside 1 to 30 Then returns 400 without loading', async () => {
    let loaded = 0;
    const endpoint = api(async days => { loaded += 1; return empty(days); });
    for (const days of ['0', '31', '1.5', 'abc', '']) {
      const response = await endpoint.request(`/api/stats?days=${days}`);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(Object.keys(await response.json()), ['error']);
    }
    assert.equal(loaded, 0);
  });

  it('When the method is not GET Then returns 405', async () => {
    const response = await api().request('/api/stats', { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
    assert.deepEqual(Object.keys(await response.json()), ['error']);
  });

  it('When the query fails Then returns 502 without the internal message', async () => {
    const response = await api(async () => { throw new Error('private-sql'); }).request('/api/stats');
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['error']);
    assert.doesNotMatch(JSON.stringify(body), /private-sql/);
  });
});
