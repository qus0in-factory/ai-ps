import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResearchWebReader } from '../../../src/infra/research-web-reader.ts';

const publicDns = ['93.184.216.34'];
const lookup = async () => publicDns;
const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
describe('Given the research webpage reader', () => {
  it('When the research request is cancelled Then stops page consumption without exposing the abort reason', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = html('unused');
    const reader = createResearchWebReader({ lookup, fetcher: async () => {
      controller.abort('private-topic'); cancelled = true; return response;
    } });
    const result = await reader.read('https://example.com', controller.signal);
    assert.equal(cancelled, true); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private-topic/);
  });
  it('When server policy permits only searched hosts Then refuses other hosts, literal IPs and cross-host redirects before page fetch', async () => {
    const allowedHosts = new Set(['example.com']);
    let lookups = 0; let fetches = 0;
    const reader = createResearchWebReader({ allowedHosts, allowIpLiterals: false,
      lookup: async () => { lookups++; return publicDns; }, fetcher: async () => { fetches++; return new Response(null, { status: 302, headers: { location: 'https://elsewhere.com' } }); } });
    for (const url of ['https://elsewhere.com', 'https://93.184.216.34', 'https://[2606:4700::1111]']) assert.equal((await reader.read(url)).ok, false);
    assert.equal(lookups, 0); assert.equal(fetches, 0);
    assert.equal((await reader.read('https://example.com')).ok, false);
    assert.equal(lookups, 1); assert.equal(fetches, 1);
    allowedHosts.add('elsewhere.com');
    const accepted = createResearchWebReader({ allowedHosts, allowIpLiterals: false, lookup, fetcher: async () => html('<p>Indexed source</p>') });
    assert.equal((await accepted.read('https://elsewhere.com')).ok, true);
  });
  it('When reading HTML Then extracts main text, decodes entities and discards page chrome and executable content', async () => {
    const reader = createResearchWebReader({ lookup, fetcher: async (_url, init) => {
      assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
      return html('<title>A &amp; B</title><nav>menu</nav><main><h1>Research</h1><script>secret script</script><style>hidden style</style><p>Clean &lt;body&gt; &#x1F333; &#38; text.</p><p>Second&nbsp;line</p></main><footer>footer</footer>');
    } });
    assert.deepEqual(await reader.read('https://example.com/article#section'), { ok: true, value: {
      url: 'https://example.com/article', title: 'A & B', content: 'Research\nClean <body> 🌳 & text.\nSecond line',
    } });
  });
  it('When reading plain text Then truncates at the contract limit of 4000 characters', async () => {
    const result = await createResearchWebReader({ lookup, fetcher: async () => new Response('a'.repeat(5000), { headers: { 'content-type': 'text/plain' } }) }).read('https://example.com');
    assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.content.length, 4000);
  });
  it('When URLs target local, private, reserved or non-HTTP destinations Then blocks before any fetch', async () => {
    let lookups = 0; let fetches = 0;
    const reader = createResearchWebReader({ lookup: async () => { lookups++; return publicDns; }, fetcher: async () => { fetches++; return html('<p>Must not read</p>'); } });
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'http://localhost', 'http://LOCALHOST.', 'http://foo.localhost', 'http://metadata.google.internal', 'http://service.local', 'http://singlelabel', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://10.0.0.1', 'http://172.16.0.1', 'http://192.168.1.1', 'http://169.254.169.254', 'http://100.64.0.1', 'http://0.0.0.0', 'http://224.0.0.1', 'http://192.0.2.1', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://[fc00::1]', 'http://[fe80::1]', 'http://[2001:db8::1]', 'https://example.com:8443']) {
      assert.equal((await reader.read(url)).ok, false, url);
    }
    assert.equal(lookups, 0); assert.equal(fetches, 0);
  });
  it('When DNS contains any private address or lookup fails Then never fetches the page', async () => {
    for (const lookup of [async () => [], async () => ['93.184.216.34', '127.0.0.1'], async () => ['::ffff:10.0.0.1'], async () => ['2001:0db8::1'], async () => { throw Error('private diagnostics'); }]) {
      let fetches = 0;
      assert.equal((await createResearchWebReader({ lookup, fetcher: async () => { fetches++; return html('<p>Must not read</p>'); } }).read('https://example.com')).ok, false);
      assert.equal(fetches, 0);
    }
  });
  it('When using public IPv4 or IPv6 literals Then reads them without a DNS request', async () => {
    for (const url of ['https://93.184.216.34', 'https://[2606:4700:4700::1111]']) {
      const result = await createResearchWebReader({ lookup: async () => { assert.fail('literal needs no lookup'); }, fetcher: async () => html('<p>Public address</p>') }).read(url);
      assert.equal(result.ok, true);
    }
  });
  it('When short IPv6 hextets refer to reserved space Then blocks before fetching', async () => {
    let calls = 0;
    const reader = createResearchWebReader({ fetcher: async () => { calls++; return html('<p>Must not read</p>'); } });
    for (const url of ['https://[2::1]', 'https://[3::1]', 'https://[20a::1]']) assert.equal((await reader.read(url)).ok, false);
    assert.equal(calls, 0);
  });
  it('When using the default resolver Then checks both DNS families using bounded DNS-over-HTTPS responses', async () => {
    const calls: string[] = [];
    const reader = createResearchWebReader({ fetcher: async input => {
      const url = new URL(String(input)); calls.push(url.href);
      if (url.hostname === 'cloudflare-dns.com') {
        assert.equal(url.searchParams.get('name'), 'example.com');
        return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
      }
      return html('<p>Public page</p>');
    } });
    assert.equal((await reader.read('https://example.com')).ok, true);
    assert.equal(calls.length, 3);
  });
  it('When the resolver returns private, malformed or failed DNS answers Then fails closed before fetching a page', async () => {
    for (const dnsResponse of [
      { Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] },
      { Status: 0, Answer: [{ type: 28, data: 'fd00::1' }] },
      { Status: 0, Answer: [{ type: 1, data: 42 }] },
      { Status: 3 }, { Status: 0, Answer: 'malformed' }, { Status: 0 },
    ]) {
      let pageRequests = 0;
      const reader = createResearchWebReader({ fetcher: async input => {
        if (new URL(String(input)).hostname === 'cloudflare-dns.com') return Response.json(dnsResponse);
        pageRequests++; return html('<p>Must not read</p>');
      } });
      assert.equal((await reader.read('https://example.com')).ok, false);
      assert.equal(pageRequests, 0);
    }
  });
  it('When redirected Then validates each destination and rejects loops and private destinations', async () => {
    let calls = 0;
    const reader = createResearchWebReader({ lookup, fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } });
    assert.equal((await reader.read('https://example.com')).ok, false); assert.equal(calls, 1);
    const loop = createResearchWebReader({ lookup, fetcher: async () => new Response(null, { status: 302, headers: { location: '/loop' } }) });
    assert.equal((await loop.read('https://example.com')).ok, false);
    const valid = createResearchWebReader({ lookup, fetcher: async input => String(input).endsWith('/next') ? html('<p>Destination</p>') : new Response(null, { status: 301, headers: { location: '/next' } }) });
    const result = await valid.read('https://example.com/start');
    assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.url, 'https://example.com/next');
  });
  it('When bodies exceed header or streaming size limits Then cancels consumption and returns a safe failure', async () => {
    let cancelled = false;
    for (const response of [html('small', { 'content-length': '1048577' }), new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } })]) {
      assert.equal((await createResearchWebReader({ lookup, fetcher: async () => response }).read('https://example.com')).ok, false);
    }
    assert.equal(cancelled, true);
  });
  it('When a body stalls Then enforces the deadline even if the injected stream ignores cancellation', async () => {
    const response = new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/html' } });
    const result = await createResearchWebReader({ lookup, timeoutMs: 15, fetcher: async () => response }).read('https://example.com');
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /시간/);
  });
  it('When the provider errors or returns unsupported or empty content Then hides raw diagnostics', async () => {
    for (const fetcher of [async () => html('private-provider-body', { 'content-type': 'application/pdf' }), async () => new Response('private-provider-body', { status: 403 }), async () => { throw Error('private-provider-body'); }, async () => html('<script>private-provider-body</script>')]) {
      const result = await createResearchWebReader({ lookup, fetcher }).read('https://example.com');
      assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private-provider-body/);
    }
  });
});
