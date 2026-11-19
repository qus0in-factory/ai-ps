import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPrimaryFallbackSearch } from '../../../src/infra/research-fallback-search.ts';
import type { ResearchSearchProvider } from '../../../src/infra/research-merged-search.ts';

const ncpHit = { title: 'NAVER', url: 'https://example.com/ncp', description: '' };
const braveHit = { title: 'Brave', url: 'https://example.com/brave', description: '' };
const unavailable = { ok: false, reason: 'Provider unavailable' } as const;

function configuredSearch(options: {
  ncp?: Awaited<ReturnType<ResearchSearchProvider['search']>>;
  brave?: Awaited<ReturnType<ResearchSearchProvider['search']>>;
} = {}) {
  const calls: { provider: string; query: string; count?: number; signal?: AbortSignal }[] = [];
  const search = createPrimaryFallbackSearch({ async search(query, count, signal) {
    calls.push({ provider: 'ncp', query, count, signal });
    return options.ncp ?? { ok: true, value: [ncpHit] };
  } }, { async search(query, count, signal) {
    calls.push({ provider: 'brave', query, count, signal });
    return options.brave ?? { ok: true, value: [braveHit] };
  } });
  return { search, calls };
}

describe('Given both NCP and Brave research search providers', () => {
  it('When the query has no Hangul Then calls only Brave', async () => {
    const { search, calls } = configuredSearch();
    assert.deepEqual(await search.search('parks', 2), { ok: true, value: [braveHit] });
    assert.deepEqual(calls.map(call => call.provider), ['brave']);
  });

  it('When NCP fails Then passes the query, limit and cancellation signal to Brave', async () => {
    const { search, calls } = configuredSearch({ ncp: unavailable });
    const signal = new AbortController().signal;

    assert.deepEqual(await search.search('공원', 3, signal), { ok: true, value: [braveHit] });
    assert.deepEqual(calls, [
      { provider: 'ncp', query: '공원', count: 3, signal },
      { provider: 'brave', query: '공원', count: 3, signal },
    ]);
  });

  it('When NCP returns too few results Then fills from Brave and deduplicates URLs', async () => {
    const { search, calls } = configuredSearch({ brave: { ok: true, value: [braveHit, ncpHit] } });

    assert.deepEqual(await search.search('공원', 3), { ok: true, value: [ncpHit, braveHit] });
    assert.deepEqual(calls.map(call => call.provider), ['ncp', 'brave']);
  });

  it('When one NCP result fills a one-result request Then skips Brave', async () => {
    const { search, calls } = configuredSearch();
    assert.deepEqual(await search.search('공원', 1), { ok: true, value: [ncpHit] });
    assert.deepEqual(calls.map(call => call.provider), ['ncp']);
  });

  it('When Brave fails to supplement NCP Then preserves the partial NCP results', async () => {
    const { search, calls } = configuredSearch({ brave: unavailable });
    assert.deepEqual(await search.search('공원', 3), { ok: true, value: [ncpHit] });
    assert.deepEqual(calls.map(call => call.provider), ['ncp', 'brave']);
  });
});
