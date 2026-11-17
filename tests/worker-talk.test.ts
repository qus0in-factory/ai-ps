import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
import type { R2Bucket } from '../src/infra/r2-audio-cache.ts';
function fakeSpeechSocket() {
  class Socket extends EventTarget {
    readyState = 1;
    accept() {}
    close() { this.readyState = 3; }
    send(raw: string) {
      const event = JSON.parse(raw);
      const receive = (value: unknown) => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
      if (event.type === 'session.update') queueMicrotask(() => receive({ type: 'session.updated' }));
      if (event.type === 'response.create') queueMicrotask(() => {
        receive({ type: 'response.output_audio.delta', delta: btoa('\x00\x00\x00\x00') });
        receive({ type: 'response.done', response: { status: 'completed' } });
      });
    }
  }
  return new Socket();
}
function speechRequest() {
  return new Request('https://ai-ps.test/api/talk/speech', { method: 'POST', body: JSON.stringify({ text: 'こんにちは。' }) });
}
describe('Given the Workers text Talk composition', () => {
  it('When speech misses and then hits R2 Then makes one header-authenticated provider call and writes WAV metadata', async t => {
    let calls = 0; let puts = 0;
    const entries = new Map<string, ArrayBuffer>();
    const bucket: R2Bucket = {
      get: async key => entries.has(key) ? { arrayBuffer: async () => entries.get(key)! } : null,
      put: async (key, bytes, options) => {
        puts++; assert.match(key, /^tts\/v1\/[a-f0-9]{64}\.wav$/);
        assert.equal(bytes.byteLength, 48); assert.equal(options.httpMetadata.contentType, 'audio/wav');
        assert.deepEqual(options.customMetadata, { model: 'custom-realtime', voice: 'marin' }); entries.set(key, bytes);
      },
    };
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      calls++; assert.equal(url, 'https://gateway.test/v1/realtime?model=custom-realtime');
      assert.equal(new Headers(init?.headers).get('Upgrade'), 'websocket');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer server-only-test-key');
      return { status: 101, webSocket: fakeSpeechSocket() };
    });
    const env = { ASSETS: { fetch: async () => new Response('assets') }, TALK_AUDIO: bucket,
      OPENAI_API_KEY: 'server-only-test-key', OPENAI_REALTIME_MODEL: 'custom-realtime', OPENAI_TTS_VOICE: 'marin',
      OPENAI_BASE_URL: 'https://gateway.test/v1', LOG_LEVEL: 'silent' };
    const first = await worker.fetch(speechRequest(), env); assert.equal(first.status, 200);
    assert.equal(first.headers.get('X-Talk-Cache'), 'miss'); assert.equal(calls, 1); assert.equal(puts, 1);
    const second = await worker.fetch(speechRequest(), env); assert.equal(second.status, 200);
    assert.equal(second.headers.get('X-Talk-Cache'), 'hit'); assert.equal(calls, 1); assert.equal(puts, 1);
    assert.deepEqual(await first.arrayBuffer(), await second.arrayBuffer());
  });
  it('When R2 is not bound Then still serves speech without caching and warns once', async t => {
    let calls = 0; const warnings: unknown[] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
    t.mock.method(globalThis, 'fetch', async () => { calls++; return { status: 101, webSocket: fakeSpeechSocket() }; });
    const env = { ASSETS: { fetch: async () => new Response('assets') }, OPENAI_API_KEY: 'server-only-test-key', LOG_LEVEL: 'warn' };
    for (let i = 0; i < 2; i++) {
      const response = await worker.fetch(speechRequest(), env);
      assert.equal(response.status, 200); assert.equal(response.headers.get('X-Talk-Cache'), 'miss');
      assert.equal((await response.arrayBuffer()).byteLength, 48);
    }
    assert.equal(calls, 2); assert.equal(warnings.length, 1);
    assert.match(JSON.stringify(warnings), /tts_cache_unbound/); assert.doesNotMatch(JSON.stringify(warnings), /server-only|こんにちは/);
  });
  it('When Japanese audio is uploaded Then uses the STT model and shared credentials/base URL', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      calls++;
      assert.equal(url, 'https://gateway.test/v1/audio/transcriptions');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer server-only-test-key');
      const body = init?.body as FormData;
      assert.equal(body.get('model'), 'test-transcribe'); assert.equal(body.get('language'), 'ja');
      assert.equal((body.get('file') as File).size, 3);
      return Response.json({ text: 'こんにちは。' });
    });
    const form = new FormData(); form.append('audio', new Blob(['wav'], { type: 'audio/wav' }), 'speech.wav');
    const response = await worker.fetch(new Request('https://ai-ps.test/api/talk/transcribe', { method: 'POST', body: form }), {
      ASSETS: { fetch: async () => { assert.fail('must route through API'); } },
      OPENAI_MODEL: 'text-model', OPENAI_TRANSCRIBE_MODEL: 'test-transcribe',
      OPENAI_BASE_URL: 'https://gateway.test/v1', OPENAI_API_KEY: 'server-only-test-key', LOG_LEVEL: 'silent',
    });
    assert.equal(response.status, 200); assert.equal(calls, 1);
    assert.deepEqual(await response.json(), { text: 'こんにちは。' });
  });
  it('When the turn route is used Then calls the shared BFF model without temperature and returns no credentials', async t => {
    const calls: Record<string, unknown>[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      assert.equal((init!.headers as Record<string,string>).Authorization, 'Bearer server-only-test-key');
      return Response.json({ choices: [{ message: { role: 'assistant', content: '{"reply":"元気ですか？","correction":null,"betterExpression":null}' } }] });
    });
    const response = await worker.fetch(new Request('https://ai-ps.test/api/talk/turn', { method: 'POST', body: '{"session":{"version":1,"turns":[]},"text":"こんにちは"}' }), {
      ASSETS: { fetch: async () => new Response('assets') }, OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'server-only-test-key', LOG_LEVEL: 'silent',
    });
    assert.equal(response.status, 200); assert.equal(calls.length, 1);
    assert.equal(calls[0]!.reasoning_effort, 'none'); assert.equal('temperature' in calls[0]!, false);
    assert.equal('tools' in calls[0]!, false); assert.equal(calls[0]!.model, 'test-model');
    assert.ok(!(await response.text()).includes('server-only-test-key'));
  });
});
