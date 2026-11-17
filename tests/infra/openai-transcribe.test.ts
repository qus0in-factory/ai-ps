import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAITranscriber } from '../../src/infra/openai-transcribe.ts';

const audio = () => new Blob(['fake audio'], { type: 'audio/webm;codecs=opus' });
describe('Given the OpenAI Japanese transcriber', () => {
  it('When transcribing Then posts multipart Japanese audio with defaults and a 30 second deadline', async t => {
    const timeout = AbortSignal.timeout;
    const durations: number[] = [];
    t.mock.method(AbortSignal, 'timeout', (ms: number) => { durations.push(ms); return timeout(ms); });
    const controller = new AbortController();
    const transcriber = createOpenAITranscriber({ apiKey: 'private-test-key', fetcher: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-test-key');
      assert.equal(new Headers(init?.headers).has('Content-Type'), false);
      assert.equal(init?.method, 'POST');
      const body = init?.body as FormData;
      assert.equal(body.get('model'), 'gpt-transcribe'); assert.equal(body.get('language'), 'ja');
      const file = body.get('file') as File;
      assert.equal(file.type, 'audio/webm;codecs=opus'); assert.match(file.name, /\.webm$/);
      assert.equal(await file.text(), 'fake audio');
      assert.ok(init?.signal); controller.abort(); assert.equal(init.signal.aborted, true);
      return Response.json({ text: 'こんにちは。' });
    } });
    assert.deepEqual(await transcriber.transcribe(audio(), controller.signal), { ok: true, value: 'こんにちは。' });
    assert.deepEqual(durations, [30_000]);
  });
  it('When model and base URL are overridden Then uses them and accepts empty recognition text', async () => {
    const transcriber = createOpenAITranscriber({ apiKey: 'key', model: 'custom-stt', baseUrl: 'https://gateway.test/v1/', fetcher: async (url, init) => {
      assert.equal(url, 'https://gateway.test/v1/audio/transcriptions');
      assert.equal((init!.body as FormData).get('model'), 'custom-stt');
      return Response.json({ text: '' });
    } });
    assert.deepEqual(await transcriber.transcribe(audio()), { ok: true, value: '' });
  });
  it('When providers fail Then returns only safe errors and emits no audio, transcript or diagnostic text', async t => {
    const logs: unknown[] = [];
    for (const method of ['error', 'warn', 'info', 'debug', 'log'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
    for (const fetcher of [async () => Response.json({ error: { message: 'sk-private-test-key fake audio 秘密の発話' } }, { status: 401 }),
      async () => { throw Error('sk-private-test-key fake audio 秘密の発話'); },
      async () => Response.json({ text: 123 }), async () => new Response('not JSON')]) {
      const result = await createOpenAITranscriber({ apiKey: 'sk-private-test-key', fetcher }).transcribe(audio());
      assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /sk-private|fake audio|秘密/);
    }
    assert.doesNotMatch(JSON.stringify(logs), /sk-private|fake audio|秘密/);
  });
  it('When timed out or cancelled Then reports a safe distinct reason and respects cancellation', async t => {
    const timedOut = AbortSignal.abort(new DOMException('private', 'TimeoutError'));
    t.mock.method(AbortSignal, 'timeout', () => timedOut);
    const fetcher: typeof fetch = async (_url, init) => { init?.signal?.throwIfAborted(); throw Error('unexpected'); };
    const result = await createOpenAITranscriber({ apiKey: 'key', fetcher }).transcribe(audio());
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /시간.*초과/);
    const cancelled = await createOpenAITranscriber({ apiKey: 'key', fetcher }).transcribe(audio(), AbortSignal.abort());
    assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.match(cancelled.reason, /중단/);
  });
  it('When credentials are absent Then never calls the provider', async () => {
    const result = await createOpenAITranscriber({ fetcher: async () => { assert.fail('must not fetch'); } }).transcribe(audio());
    assert.equal(result.ok, false);
  });
});
