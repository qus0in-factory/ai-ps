import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/worker.ts';

function environment(): Env {
  return { ASSETS: { fetch: async request => new Response(`asset:${new URL(request.url).pathname}`) }, LOG_LEVEL: 'silent' };
}

describe('Given the Workers composition root', () => {
  it('When a SPA route is requested Then delegates the original request to the assets binding', async () => {
    const request = new Request('https://ai-ps.test/queen?size=5');
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
    const invalid = await worker.fetch(new Request('https://ai-ps.test/api/queen/generate', {
      method: 'POST', body: JSON.stringify({ size: 2 }),
    }), env);
    assert.equal(invalid.status, 400);
    const missing = await worker.fetch(new Request('https://ai-ps.test/api/unknown'), env);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('Content-Type')!, /application\/problem\+json/);
  });
});
