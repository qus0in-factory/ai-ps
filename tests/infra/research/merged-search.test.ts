import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMergedResearchSearch } from '../../../src/infra/research-merged-search.ts';
import type { ResearchSearchResult } from '../../../src/infra/research-brave-search.ts';
const hit = (url: string): ResearchSearchResult => ({ title: url, url, description: 'Summary' });
const provider = (urls: string[]) => ({ search: async () => ({ ok: true as const, value: urls.map(hit) }) });
describe('Given Brave and NCP research search providers', () => {
  it('When merging Then interleaves providers, removes canonical duplicate URLs and respects the total result cap', async () => {
    const adapter = createMergedResearchSearch([provider(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']), provider(['https://EXAMPLE.com:443/a#top', 'https://naver.example/news', 'https://naver.example/blog'])]);
    const result = await adapter.search('parks', 4);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.map(item => item.url), ['https://example.com/a', 'https://example.com/b', 'https://naver.example/news', 'https://example.com/c']);
  });
  it('When one provider fails or throws Then retains the successful provider without diagnostics', async () => {
    for (const search of [async () => ({ ok: false as const, reason: 'private-key' }), async () => { throw Error('private-key'); }]) {
      assert.deepEqual(await createMergedResearchSearch([{ search }, provider(['https://example.com'])]).search('parks'), { ok: true, value: [hit('https://example.com')] });
    }
    assert.deepEqual(await createMergedResearchSearch([provider([])]).search('parks'), { ok: true, value: [] });
  });
  it('When providers all fail Then returns only a safe failure and forwards cancellation', async () => {
    const signal = new AbortController().signal; const calls: unknown[] = [];
    const adapter = createMergedResearchSearch([{ search: async (query, max, external) => { calls.push([query, max, external]); return { ok: false, reason: 'private-key' }; } }]);
    const result = await adapter.search('parks', 5, signal);
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private-key/); assert.deepEqual(calls, [['parks', 5, signal]]);
    assert.equal((await createMergedResearchSearch([]).search('parks')).ok, false);
  });
});
