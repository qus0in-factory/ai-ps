import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNcpSearch } from '../../../src/infra/research-ncp-search.ts';

describe('Given the NCP NAVER API HUB search adapter', () => {
  it('When searching Then queries web, news and blogs and removes HTML markup while preferring original news URLs', async () => {
    const paths: string[] = [];
    const adapter = createNcpSearch({ apiKeyId: 'fake-id', apiKey: 'fake-secret', fetcher: async (input, init) => {
      const url = new URL(String(input)); paths.push(url.pathname);
      assert.equal(url.origin, 'https://naverapihub.apigw.ntruss.com');
      assert.equal(url.searchParams.get('query'), '도시 공원'); assert.equal(url.searchParams.get('display'), '3');
      assert.equal(url.searchParams.get('format'), 'json'); assert.equal(url.searchParams.get('start'), '1');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-NCP-APIGW-API-KEY-ID'), 'fake-id'); assert.equal(headers.get('X-NCP-APIGW-API-KEY'), 'fake-secret');
      assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
      if (url.pathname.endsWith('/news')) return Response.json({ items: [{ title: '<b>뉴스</b>', link: 'https://news.naver.com/article/1', originallink: 'https://paper.example/story', description: '새로운 &quot;공원&quot; &#x1F333;' }] });
      if (url.pathname.endsWith('/blog')) return Response.json({ items: [{ title: '<b>도시</b>공원', link: 'https://blog.naver.com/user/1', description: '<p>블로그</p><script>hidden</script> &lt;b&gt;요약&lt;/b&gt;' }] });
      // Real response fields observed in the single live probe, with synthetic text.
      return Response.json({ lastBuildDate: 'Thu, 19 Nov 2026 15:00:00 +0900', total: 2, start: 1, display: 2, items: [
        { title: '<b>공원</b> &amp; 도시', link: 'https://example.com/park', description: '도시의 <b>공원</b> 정보' },
        { title: '웹 2', link: 'https://example.com/other', description: '다른 결과' },
      ] });
    } });
    assert.deepEqual(await adapter.search(' 도시 공원 ', 3), { ok: true, value: [
      { title: '공원 & 도시', url: 'https://example.com/park', description: '도시의 공원 정보' },
      { title: '뉴스', url: 'https://paper.example/story', description: '새로운 "공원" 🌳' },
      { title: '도시공원', url: 'https://blog.naver.com/user/1', description: '블로그 요약' },
    ] });
    assert.deepEqual(paths.sort(), ['/search/v1/blog', '/search/v1/news', '/search/v1/webkr']);
  });
  it('When categories overlap or return unsafe URLs Then deduplicates canonical URLs and discards unsafe targets', async () => {
    const adapter = createNcpSearch({ apiKeyId: 'id', apiKey: 'key', fetcher: async input => Response.json({ items: new URL(String(input)).pathname.endsWith('/news') ? [
      { title: 'Duplicate', link: 'https://EXAMPLE.com:443/a#news', description: '' },
      { title: 'Other', link: 'https://example.com/b', description: '' },
    ] : [
      { title: 'First', link: 'https://example.com/a', description: '' },
      { title: 'Unsafe', link: 'javascript:alert(1)', description: '' },
      { title: 'Credentials', link: 'https://user:pass@example.com', description: '' },
    ] }) });
    const outcome = await adapter.search('parks', 5); assert.equal(outcome.ok, true);
    if (outcome.ok) assert.deepEqual(outcome.value.map(item => item.url), ['https://example.com/a', 'https://example.com/b']);
  });
  it('When one category fails Then keeps successful category results without exposing provider bodies', async () => {
    const adapter = createNcpSearch({ apiKeyId: 'id', apiKey: 'key', fetcher: async input => new URL(String(input)).pathname.endsWith('/news')
      ? Response.json({ items: [{ title: 'News', link: 'https://example.com/news', description: 'Summary' }] })
      : new Response('fake-secret private-provider-body', { status: 401 }) });
    assert.deepEqual(await adapter.search('parks'), { ok: true, value: [{ title: 'News', url: 'https://example.com/news', description: 'Summary' }] });
  });
  it('When credentials, query or cancellation prevent a call Then does no network work', async () => {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return Response.json({ items: [] }); };
    assert.equal((await createNcpSearch({ apiKey: 'key', fetcher }).search('parks')).ok, false);
    const adapter = createNcpSearch({ apiKeyId: 'id', apiKey: 'key', fetcher });
    assert.equal((await adapter.search(' ')).ok, false);
    assert.equal((await adapter.search('parks', 5, AbortSignal.abort())).ok, false); assert.equal(calls, 0);
  });
  it('When categories all fail, return malformed data, oversized data or stall Then returns a safe failure', async () => {
    for (const fetcher of [
      async () => new Response('fake-secret private-provider-body', { status: 401 }),
      async () => { throw Error('fake-secret private-provider-body'); },
      async () => Response.json({ items: 'invalid' }), async () => new Response('invalid json'),
      async () => Response.json({ items: [{ title: 123, link: 'https://example.com' }] }),
      async () => new Response('x'.repeat(1024 * 1024 + 1)),
      async () => new Promise<Response>(() => {}),
    ]) {
      const result = await createNcpSearch({ apiKeyId: 'id', apiKey: 'fake-secret', timeoutMs: 15, fetcher }).search('parks');
      assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /fake-secret|private-provider-body/);
    }
  });
});
