import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.ts';
const assets = { fetch: async () => new Response('asset') };
const request = (body = '{"topic":"도시 공원"}', path = '/api/research', headers: Record<string, string> = {}) => new Request('https://ai-ps.test' + path, { method: 'POST', body, headers });
const env = () => ({ ASSETS: assets, LOG_LEVEL: 'silent', OPENAI_MODEL: 'research-model', OPENAI_API_KEY: 'private-openai', OPENAI_BASE_URL: 'https://model.example/v1', BRAVE_SEARCH_API_KEY: 'private-brave', RESEARCH_LIMIT: { limit: async () => ({ success: true }) } });

describe('Given the Workers research composition', () => {
  for (const brave of ['ok', 'failed', 'missing'] as const) {
    it(`When Brave is ${brave} and NCP is configured Then uses cleaned NAVER categories with duplicate URLs removed`, async t => {
      let models = 0; let braveCalls = 0; let ncpCalls = 0;
      t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === 'model.example') {
          models++; const body = JSON.parse(String(init?.body));
          if (models === 1) return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'search', type: 'function', function: { name: 'search_web', arguments: '{"query":"공원","max_results":5}' } }] } }] });
          if (models === 2) {
            const toolText = body.messages.at(-1).content;
            assert.match(toolText, /NAVER News/); assert.match(toolText, /NAVER Blog/); assert.match(toolText, /NAVER Web/);
            assert.doesNotMatch(toolText, /<\/?b>|private-/);
            assert.equal((toolText.match(/https:\/\/example.com\/shared/g) ?? []).length, 1);
            // Korean query uses NCP first; Brave is only a fallback.
            return Response.json({ choices: [{ message: { role: 'assistant', content: 'Search notes' } }] });
          }
          if (models === 3) return Response.json({ choices: [{ message: { role: 'assistant', content: '# Report' } }] });
          assert.equal(body.response_format?.json_schema?.name, 'evaluation');
          return Response.json({ choices: [{ message: { role: 'assistant', content: '{"passed":true,"problems":[]}' } }] });
        }
        if (url.hostname === 'api.search.brave.com') {
          braveCalls++;
          return brave === 'failed' ? new Response('private-brave-error', { status: 503 }) : Response.json({ web: { results: [
            { title: 'Brave result', url: 'https://example.com/shared', description: 'Shared' },
            { title: 'Brave other', url: 'https://example.com/brave', description: 'Other' },
          ] } });
        }
        ncpCalls++; assert.equal(url.hostname, 'naverapihub.apigw.ntruss.com');
        const headers = new Headers(init?.headers); assert.equal(headers.get('X-NCP-APIGW-API-KEY-ID'), 'private-ncp-id'); assert.equal(headers.get('X-NCP-APIGW-API-KEY'), 'private-ncp-key');
        const category = url.pathname.split('/').at(-1);
        return Response.json({ items: category === 'webkr' ? [
          { title: 'Shared', link: 'https://example.com/shared#naver', description: 'Same source' },
          { title: '<b>NAVER Web</b>', link: 'https://example.com/naver', description: 'Web summary' },
        ] : [{ title: `<b>NAVER ${category === 'news' ? 'News' : 'Blog'}</b>`, link: `https://example.com/${category}`, description: '<b>Clean</b> summary' }] });
      });
      const response = await worker.fetch(request(), { ...env(), BRAVE_SEARCH_API_KEY: brave === 'missing' ? undefined : 'private-brave', NCP_API_KEY_ID: 'private-ncp-id', NCP_API_KEY: 'private-ncp-key' });
      assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.steps[0].ok, true);
      assert.equal(models, 4); assert.equal(ncpCalls, 3); assert.equal(braveCalls, 0);
    });
  }
  it('When the production quota binding is missing or fails Then refuses external work with a safe error', async t => {
    let calls = 0; const keys: string[] = [];
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}); });
    for (const binding of [undefined, { limit: async ({ key }: { key: string }) => { keys.push(key); throw Error('private-limiter'); } }]) {
      const response = await worker.fetch(request(), { ...env(), RESEARCH_LIMIT: binding });
      assert.equal(response.status, 503); const body = await response.json(); assert.deepEqual(Object.keys(body), ['error']); assert.doesNotMatch(JSON.stringify(body), /private-limiter/);
    }
    assert.deepEqual(keys, ['anon']); assert.equal(calls, 0);
  });
  it('When the IP exceeds three requests Then blocks before parsing, including encoded route aliases', async t => {
    let fetches = 0; let count = 0; const keys: string[] = [];
    t.mock.method(globalThis, 'fetch', async () => { fetches++; return Response.json({}); });
    const bindings = { ...env(), RESEARCH_LIMIT: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: ++count <= 3 }; } } };
    for (let index = 0; index < 3; index++) assert.equal((await worker.fetch(request('{}', '/api/research', { 'CF-Connecting-IP': '192.0.2.8' }), bindings)).status, 400);
    const response = await worker.fetch(request('not-json', '/api/%72esearch', { 'CF-Connecting-IP': '192.0.2.8' }), bindings);
    assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
    assert.deepEqual(Object.keys(await response.json()), ['error']);
    assert.deepEqual(keys, Array(4).fill('192.0.2.8')); assert.equal(fetches, 0);
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    const quota = config.ratelimits.find((entry: { name: string }) => entry.name === 'RESEARCH_LIMIT');
    assert.deepEqual(quota.simple, { limit: 3, period: 60 });
    assert.equal(new Set(config.ratelimits.map((entry: { namespace_id: string }) => entry.namespace_id)).size, config.ratelimits.length);
  });
  it('When declared or actual bodies exceed 4KiB Then rejects without provider work and handles methods with the error contract', async t => {
    let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({}); });
    for (const req of [request('x'.repeat(4097)), request('{}', '/api/research', { 'Content-Length': '4097' })]) {
      const response = await worker.fetch(req, env()); assert.equal(response.status, 413); assert.deepEqual(Object.keys(await response.json()), ['error']);
    }
    const method = await worker.fetch(new Request('https://ai-ps.test/api/research'), env());
    assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'POST'); assert.deepEqual(Object.keys(await method.json()), ['error']);
    assert.equal(calls, 0);
  });
  it('When researching Then composes OpenAI, Brave and protected page reading and logs only aggregate metrics', async t => {
    let modelCalls = 0; let searchCalls = 0; let ncpCalls = 0; let pageCalls = 0; let dnsCalls = 0;
    const logs: unknown[] = [];
    t.mock.method(console, 'info', (...args: unknown[]) => logs.push(args));
    t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === 'model.example') {
        modelCalls++; const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'research-model'); assert.equal(url.pathname, '/v1/chat/completions');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-openai');
        if (modelCalls === 1) {
          assert.equal(body.temperature, 0.2); assert.equal(body.tools.length, 2); assert.equal(body.tools[0].function.strict, false);
          return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'search', type: 'function', function: { name: 'search_web', arguments: '{"query":"parks","max_results":5}' } }] } }] });
        }
        if (modelCalls === 2) {
          assert.match(JSON.stringify(body.messages), /Park summary/);
          return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_webpage', arguments: '{"url":"https://example.com/parks"}' } }] } }] });
        }
        if (modelCalls === 3) {
          assert.match(JSON.stringify(body.messages), /Public park facts/);
          return Response.json({ choices: [{ message: { role: 'assistant', content: '조사 노트: 공원. https://example.com/parks' } }] });
        }
        if (modelCalls === 4) {
          assert.equal(body.temperature, 0.3); assert.equal(body.tools, undefined);
          return Response.json({ choices: [{ message: { role: 'assistant', content: '# 보고서\n\n공원 [출처](https://example.com/parks)' } }] });
        }
        assert.equal(body.temperature, 0); assert.equal(body.response_format?.json_schema?.name, 'evaluation');
        return Response.json({ choices: [{ message: { role: 'assistant', content: '{"passed":true,"problems":[]}' } }] });
      }
      if (url.hostname === 'api.search.brave.com') {
        searchCalls++; assert.equal(new Headers(init?.headers).get('X-Subscription-Token'), 'private-brave');
        return Response.json({ web: { results: [{ title: 'Parks', url: 'https://example.com/parks', description: 'Park summary' }] } });
      }
      if (url.hostname === 'naverapihub.apigw.ntruss.com') {
        ncpCalls++;
        return Response.json({ items: [] });
      }
      if (url.hostname === 'cloudflare-dns.com') {
        dnsCalls++; return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
      }
      pageCalls++; assert.equal(url.href, 'https://example.com/parks'); assert.equal(init?.redirect, 'manual');
      return new Response('<main><p>Public park facts</p></main>', { headers: { 'Content-Type': 'text/html' } });
    });
    const response = await worker.fetch(request(), { ...env(), LOG_LEVEL: 'info', NCP_API_KEY_ID: 'fake-id', NCP_API_KEY: 'fake-key' });
    assert.equal(response.status, 200); const body = await response.json();
    assert.match(body.report, /보고서/); assert.deepEqual(body.steps.map((step: { tool: string; ok: boolean }) => [step.tool, step.ok]), [['search_web', true], ['read_webpage', true]]);
    assert.deepEqual(body.sources, ['https://example.com/parks']); assert.equal(body.capped, false);
    assert.deepEqual(body.evaluation, { passed: true, problems: [] });
    assert.equal(modelCalls, 5); assert.equal(searchCalls, 1); assert.equal(ncpCalls, 0); assert.equal(pageCalls, 1); assert.equal(dnsCalls, 2);
    const serialized = JSON.stringify(logs); assert.doesNotMatch(serialized, /도시|공원|private-|example\.com|parks|summary|facts|192\.0/);
    assert.equal(logs.length, 1);
    const fields = (logs[0] as [{ topicLength: number; toolCalls: number }])[0]; assert.equal(fields.topicLength, 5); assert.equal(fields.toolCalls, 2);
  });
  it('When model errors contain secrets Then emits no provider diagnostics or raw response details', async t => {
    const logs: unknown[] = []; let calls = 0;
    for (const level of ['info', 'error', 'debug', 'warn'] as const) t.mock.method(console, level, (...args: unknown[]) => logs.push(args));
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: { message: 'private-openai private-brave 도시 공원' } }, { status: 401 }); });
    const response = await worker.fetch(request(), { ...env(), LOG_LEVEL: 'info' });
    assert.equal(response.status, 502); const body = await response.json(); assert.deepEqual(Object.keys(body), ['error']);
    assert.doesNotMatch(JSON.stringify({ body, logs }), /private-|도시|공원|stack|provider_http_error/); assert.equal(calls, 1);
  });
});
