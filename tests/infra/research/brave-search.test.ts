import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBraveSearch } from '../../../src/infra/research-brave-search.ts';

describe('Given the Brave research search adapter', () => {
  it('When a research request is already cancelled Then avoids provider work', async () => {
    let calls = 0;
    const result = await createBraveSearch({ apiKey: 'key', fetcher: async () => { calls++; return Response.json({ type: 'search' }); } }).search('query', 5, AbortSignal.abort());
    assert.equal(result.ok, false); assert.equal(calls, 0);
  });
  it('When searching Then maps the observed web.results shape and sends credentials only in a header', async () => {
    const adapter = createBraveSearch({ apiKey: 'secret-key', fetcher: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/web/search');
      assert.equal(url.searchParams.get('q'), '도시 공원');
      assert.equal(url.searchParams.get('count'), '2');
      assert.equal(url.searchParams.get('text_decorations'), 'false');
      assert.equal(new Headers(init?.headers).get('X-Subscription-Token'), 'secret-key');
      assert.equal(init?.redirect, 'manual');
      assert.ok(init?.signal);
      return Response.json({ type: 'search', query: {}, web: { type: 'search', results: [
        { title: 'First', url: 'https://example.com/a', description: 'Summary', profile: {} },
        { title: 'Second', url: 'https://example.com/b' },
        { title: 'Third', url: 'https://example.com/c', description: 'Third summary' },
      ] } });
    } });
    assert.deepEqual(await adapter.search(' 도시 공원 ', 2), { ok: true, value: [
      { title: 'First', url: 'https://example.com/a', description: 'Summary' },
      { title: 'Second', url: 'https://example.com/b', description: '' },
    ] });
  });
  it('When no results exist Then returns an empty list and clamps provider count', async () => {
    const adapter = createBraveSearch({ apiKey: 'key', fetcher: async input => {
      assert.equal(new URL(String(input)).searchParams.get('count'), '20');
      return Response.json({ type: 'search', query: {} });
    } });
    assert.deepEqual(await adapter.search('test', 100), { ok: true, value: [] });
  });
  it('When credentials or query are missing Then never calls the provider', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ type: 'search' }); };
    assert.equal((await createBraveSearch({ fetcher }).search('test')).ok, false);
    assert.equal((await createBraveSearch({ apiKey: 'key', fetcher }).search(' ')).ok, false);
    assert.equal(calls, 0);
  });
  it('When a fetch stalls Then returns a safe timeout within the configured deadline', async () => {
    const result = await createBraveSearch({ apiKey: 'key', timeoutMs: 15, fetcher: async () => new Promise<Response>(() => {}) }).search('test');
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /시간/);
  });
  it('When providers fail or responses are malformed Then returns a safe failure without provider text', async () => {
    for (const fetcher of [
      async () => new Response('secret-key private-provider-body', { status: 429 }),
      async () => { throw Error('secret-key private-provider-body'); },
      async () => new Response('not json'),
      async () => Response.json({ web: { results: 'bad' } }),
      async () => Response.json({ web: { results: [{ title: 123, url: 'https://example.com' }] } }),
      async () => new Response('x'.repeat(1024 * 1024 + 1)),
    ]) {
      const result = await createBraveSearch({ apiKey: 'secret-key', fetcher }).search('test');
      assert.equal(result.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /secret-key|private-provider-body/);
    }
  });
});
