import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/worker.ts';

function environment(): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    LOG_LEVEL: 'silent',
    OPENAI_MODEL: 'test-model',
    OPENAI_API_KEY: 'test-key',
  };
}

describe('Given the worker chat routing', () => {
  it('When /api/chat is posted with the default plan-execute mode Then routing runs before the first completion', async t => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    let completions = 0;
    t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      requests.push({ url, body });
      if (url.endsWith('/decisions')) {
        return Response.json({ answers: [{ type: 'choice', choice: 'luna', confidence: 0.9 }] });
      }
      completions += 1;
      const content = completions === 1
        ? JSON.stringify({ type: 'plan', goal: '답변', steps: [] })
        : JSON.stringify({ type: 'message', content: '완료' });
      return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
    });
    const response = await worker.fetch(new Request('https://ai-ps.test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '안녕' }] }),
    }), environment());
    assert.equal(response.status, 200);
    assert.ok(requests.length >= 2);
    assert.ok(requests[0]!.url.endsWith('/decisions'), requests[0]!.url);
    assert.ok(requests[1]!.url.endsWith('/chat/completions'), requests[1]!.url);
    assert.equal(requests[1]!.body.model, 'test-model');
  });
});