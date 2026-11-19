import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBraveSearch } from '../../../src/infra/research-brave-search.ts';
import { createNcpSearch } from '../../../src/infra/research-ncp-search.ts';
import { createMergedResearchSearch } from '../../../src/infra/research-merged-search.ts';
import { createResearchWebReader } from '../../../src/infra/research-web-reader.ts';

describe('Given the fetch redirect modes supported by Cloudflare Workers', () => {
  it('When searching both providers and resolving a page Then uses manual redirects throughout and preserves successful results', async () => {
    const modes: Array<RequestRedirect | undefined> = [];
    const fetcher: typeof fetch = async (input, init) => {
      modes.push(init?.redirect);
      // Reproduced with Wrangler/workerd: RequestRedirect "error" throws synchronously.
      if (init?.redirect === 'error') throw new TypeError('Unsupported redirect mode');
      const url = new URL(String(input));
      if (url.hostname === 'api.search.brave.com') return Response.json({ web: { results: [{ title: 'Brave', url: 'https://example.com/brave', description: 'Summary' }] } });
      if (url.hostname === 'naverapihub.apigw.ntruss.com') return Response.json({ items: url.pathname.endsWith('/webkr') ? [{ title: 'NCP', link: 'https://example.com/ncp', description: 'Summary' }] : [] });
      if (url.hostname === 'cloudflare-dns.com') return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
      return new Response('<main>Readable page</main>', { headers: { 'Content-Type': 'text/html' } });
    };
    const search = createMergedResearchSearch([createBraveSearch({ apiKey: 'fake-brave', fetcher }), createNcpSearch({ apiKeyId: 'fake-id', apiKey: 'fake-ncp', fetcher })]);
    const result = await search.search('parks'); assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.map(item => item.title), ['Brave', 'NCP']);
    const page = await createResearchWebReader({ fetcher }).read('https://example.com/ncp');
    assert.equal(page.ok, true); if (page.ok) assert.equal(page.value.content, 'Readable page');
    assert.deepEqual(modes, Array(7).fill('manual'));
  });
  it('When a credentialed search endpoint redirects Then refuses the redirect without forwarding credentials', async () => {
    for (const kind of ['brave', 'ncp'] as const) {
      let calls = 0; const modes: Array<RequestRedirect | undefined> = [];
      const fetcher: typeof fetch = async (input, init) => {
        calls++; modes.push(init?.redirect);
        assert.notEqual(new URL(String(input)).hostname, 'untrusted.example');
        return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
      };
      const adapter = kind === 'brave' ? createBraveSearch({ apiKey: 'fake-brave', fetcher }) : createNcpSearch({ apiKeyId: 'fake-id', apiKey: 'fake-ncp', fetcher });
      assert.equal((await adapter.search('parks')).ok, false);
      assert.equal(calls, kind === 'brave' ? 1 : 3); assert.ok(modes.every(mode => mode === 'manual'));
    }
  });
  it('When the DNS endpoint redirects Then stops before accessing any page or redirect target', async () => {
    const calls: string[] = []; const modes: Array<RequestRedirect | undefined> = [];
    const result = await createResearchWebReader({ fetcher: async (input, init) => {
      calls.push(new URL(String(input)).hostname); modes.push(init?.redirect);
      return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example' } });
    } }).read('https://example.com');
    assert.equal(result.ok, false); assert.deepEqual(calls, ['cloudflare-dns.com']); assert.deepEqual(modes, ['manual']);
  });
});
