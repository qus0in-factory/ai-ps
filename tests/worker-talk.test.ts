import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
describe('Given the Workers text Talk composition', () => {
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
