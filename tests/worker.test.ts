import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/worker.ts';

function environment(): Env {
  return { ASSETS: { fetch: async request => new Response(`asset:${new URL(request.url).pathname}`) }, LOG_LEVEL: 'silent' };
}

describe('Given the Workers composition root', () => {
  it('When Queens, chat and adventure call the model Then uses one none-reasoning diversity call only for Queens', async t => {
    const requests: Record<string, unknown>[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [] });
    });
    const env = { ...environment(), OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'test-key', OPENAI_TOOL_MODE: 'json' };
    for (const [path, body] of [
      ['/api/queens/generate', { size: 5 }],
      ['/api/chat', { messages: [{ role: 'user', content: '안녕' }] }],
      ['/api/adventure/start', {}],
    ] as const) {
      const response = await worker.fetch(new Request(`https://ai-ps.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env);
      await response.text();
    }
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map(body => body.reasoning_effort), ['none', undefined, undefined]);
    assert.ok(requests.every(body => body.model === 'test-model'));
    assert.equal((requests[0]!.response_format as { type?: string }).type, 'json_schema');
    assert.equal((requests[0]!.response_format as { json_schema?: { strict?: boolean } }).json_schema?.strict, true);
    assert.equal('temperature' in requests[0]!, false);
    assert.equal('tools' in requests[0]!, false);
  });

  it('When a SPA route is requested Then delegates the original request to the assets binding', async () => {
    const request = new Request('https://ai-ps.test/queens?size=5');
    let received: Request | undefined;
    const response = await worker.fetch(request, {
      ASSETS: { fetch: async input => { received = input; return new Response('spa'); } },
    });
    assert.equal(received, request);
    assert.equal(await response.text(), 'spa');
  });

  it('When API requests arrive Then uses Hono validation and method handling without assets', async () => {
    const env = environment();
    const method = await worker.fetch(new Request('https://ai-ps.test/api/chat'), env);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('Allow'), 'POST');
    const invalid = await worker.fetch(new Request('https://ai-ps.test/api/queens/generate', {
      method: 'POST', body: JSON.stringify({ size: 2 }),
    }), env);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).instance, '/api/queens/generate');
    const adventure = await worker.fetch(new Request('https://ai-ps.test/api/adventure/turn', { method: 'POST', body: '{}' }), env);
    assert.equal(adventure.status, 400);
    const missing = await worker.fetch(new Request('https://ai-ps.test/api/unknown'), env);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('Content-Type')!, /application\/problem\+json/);
  });
});
