import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/worker.ts';

function environment(): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') },
    LOG_LEVEL: 'silent',
    OPENAI_MODEL: 'test-model',
    OPENAI_API_KEY: 'test-key',
    OPENAI_TOOL_MODE: 'json',
  };
}

describe('Given the worker chat with a long history', () => {
  it('When the history exceeds the compactor max Then summarizes once before replying', async t => {
    const requests: Record<string, any>[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return Response.json({ choices: [{ message: {
        role: 'assistant',
        content: requests.length === 1 ? '이전 대화 요약 내용' : '{"type":"message","content":"완료"}',
      } }] });
    });
    const messages = Array.from({ length: 13 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `메시지 ${index + 1}`,
    }));
    const response = await worker.fetch(new Request('https://ai-ps.test/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }),
    }), environment());
    assert.equal(response.status, 200);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.prompt_cache_key, 'ai-ps:summary');
    assert.equal(requests[0]!.max_completion_tokens, 300);
    assert.match(String(requests[0]!.messages[0].content), /Summarize/);
    assert.ok(requests[1]!.messages.some((message: { content?: string }) => message.content?.startsWith('[이전 대화 요약]')));
  });
});
