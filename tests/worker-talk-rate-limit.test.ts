import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
const assets = { fetch: async () => new Response('asset') };
const request = (path: string, ip?: string) => new Request('https://ai-ps.test' + path, {
  method: 'POST', body: '{}', headers: ip ? { 'CF-Connecting-IP': ip } : {},
});
describe('Given the Worker Talk rate limit gate', () => {
  it('When the router accepts an encoded Talk path Then cannot bypass the same quota', async () => {
    let calls = 0;
    const response = await worker.fetch(request('/api/talk/%73peech'), { ASSETS: assets, LOG_LEVEL: 'silent',
      TALK_AUDIO_LIMIT: { limit: async () => { calls++; return { success: false }; } } });
    assert.equal(response.status, 429); assert.equal(calls, 1);
    assert.equal((await response.json()).instance, '/api/talk/speech');
  });
  it('When audio and text groups exceed their shared quotas Then rejects before parsing or provider calls and never logs IP', async t => {
    const logs: unknown[] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
    t.mock.method(globalThis, 'fetch', async () => assert.fail('must not call a provider'));
    const keys: string[] = [];
    const limiter = () => { let count = 0; return { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: ++count === 1 }; } }; };
    const env = { ASSETS: assets, TALK_AUDIO_LIMIT: limiter(), TALK_TURN_LIMIT: limiter(), LOG_LEVEL: 'warn' };
    for (const [first, second] of [['speech', 'transcribe'], ['turn', 'report']]) {
      assert.equal((await worker.fetch(request('/api/talk/' + first, '192.0.2.123'), env)).status, 400);
      const path = '/api/talk/' + second;
      const response = await worker.fetch(request(path, '192.0.2.123'), env);
      assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60');
      assert.match(response.headers.get('Content-Type')!, /application\/problem\+json/);
      assert.deepEqual(await response.json(), { type: 'about:blank', title: '요청이 너무 많습니다', status: 429,
        detail: '잠시 후 다시 시도해 주세요.', instance: path });
    }
    assert.deepEqual(keys, Array(4).fill('192.0.2.123'));
    assert.equal(logs.length, 2); assert.doesNotMatch(JSON.stringify(logs), /192\.0\.2\.123|input|text|key/);
    assert.match(JSON.stringify(logs), /rate_limited/);
  });
  it('When IP or bindings are missing Then uses anon or passes; other routes never touch the limiters', async () => {
    let calls = 0;
    const limit = async ({ key }: { key: string }) => { calls++; assert.equal(key, 'anon'); return { success: true }; };
    const env = { ASSETS: assets, TALK_AUDIO_LIMIT: { limit }, TALK_TURN_LIMIT: { limit }, LOG_LEVEL: 'silent' };
    assert.equal((await worker.fetch(request('/api/talk/speech'), env)).status, 400); assert.equal(calls, 1);
    for (const path of ['/api/queens/generate', '/api/chat', '/api/adventure/start', '/api/talk/unknown']) {
      // GET avoids model work while checking that unrelated routes do not consume Talk quotas.
      await worker.fetch(new Request('https://ai-ps.test' + path), env);
    }
    assert.equal(calls, 1);
    assert.equal((await worker.fetch(request('/api/talk/speech'), { ASSETS: assets, LOG_LEVEL: 'silent' })).status, 400);
  });
});
