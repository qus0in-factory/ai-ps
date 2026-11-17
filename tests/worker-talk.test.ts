import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
describe('Given the Workers text Talk composition', () => {
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
    const response = await worker.fetch(new Request('https://ai-ps.test/api/talk/turn', { method: 'POST', body: '{"session":{"version":1,"turns":[]}}' }), {
      ASSETS: { fetch: async () => new Response('assets') }, OPENAI_MODEL: 'test-model', OPENAI_API_KEY: 'server-only-test-key', LOG_LEVEL: 'silent',
    });
    assert.equal(response.status, 200); assert.equal(calls.length, 1);
    assert.equal(calls[0]!.reasoning_effort, 'none'); assert.equal('temperature' in calls[0]!, false);
    assert.equal('tools' in calls[0]!, false); assert.equal(calls[0]!.model, 'test-model');
    assert.ok(!(await response.text()).includes('server-only-test-key'));
  });
});
