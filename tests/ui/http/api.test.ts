import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../../src/ui/http/api.ts';
import type { ChatMessage } from '../../../src/domain/chat.ts';

const unusedReply = async () => { throw new Error('Must not call chat'); };
const unusedQueens = { generate: async () => { throw new Error('Must not generate'); } };

describe('Given the Hono API', () => {
  it('When the old singular Queens API is requested Then returns 404 without an alias', async () => {
    const api = createApi({
      adventure: { start: unusedReply, turn: unusedReply }, reply: unusedReply, queens: unusedQueens,
      talk: { tutor: { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) } },
    });
    for (const method of ['GET', 'POST']) {
      const response = await api.request('/api/queen/generate', {
        method, ...(method === 'POST' ? { body: '{"size":5}' } : {}),
      });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).instance, '/api/queen/generate');
    }
  });
  it('When an API path is unknown Then returns a 404 problem', async () => {
    const response = await createApi({ adventure: { start: async () => { throw new Error('Unexpected adventure'); }, turn: async () => { throw new Error('Unexpected adventure'); } }, reply: unusedReply, queens: unusedQueens, talk: { tutor: { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) } } }).request('/api/missing');
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Content-Type'), 'application/problem+json');
    assert.equal((await response.json()).instance, '/api/missing');
  });
  it('When the Queens client disconnects Then aborts generation', { timeout: 2000 }, async () => {
    let generationSignal: AbortSignal | undefined;
    let aborted!: () => void;
    const stopped = new Promise<void>(resolve => { aborted = resolve; });
    const api = createApi({ adventure: { start: async () => { throw new Error('Unexpected adventure'); }, turn: async () => { throw new Error('Unexpected adventure'); } }, reply: unusedReply, queens: {
      generate: async (_size, onEvent, signal) => {
        generationSignal = signal;
        onEvent?.({ kind: 'placement' });
        await new Promise<void>(resolve => signal!.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
        return { ok: false, reason: '중단됨' };
      },
    }, talk: { tutor: { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) } } });
    const response = await api.request('/api/queens/generate', { method: 'POST', body: '{"size":5}' });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await stopped;
    assert.equal(generationSignal!.aborted, true);
  });
});

describe('Given the chat endpoint', () => {
  const context: ChatMessage[] = [{ role: 'user', content: '[이전 대화 요약]\n요약' }];
  const replyWith = (contextValue: typeof context | undefined) => async () => (
    contextValue ? { ok: true as const, value: '답변', context: contextValue } : { ok: true as const, value: '답변' });
  const rest = {
    queens: unusedQueens,
    adventure: { start: async () => { throw new Error('Unexpected adventure'); }, turn: async () => { throw new Error('Unexpected adventure'); } },
    talk: { tutor: { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) } },
  };
  const body = JSON.stringify({ messages: [{ role: 'user', content: '안녕' }] });

  it('When the reply carries a compacted context Then the JSON body and the final frame include it', async () => {
    const api = createApi({ reply: replyWith(context), ...rest });
    const json = await api.request('/api/chat', { method: 'POST', body });
    assert.equal(json.status, 200);
    assert.deepEqual((await json.json()).context, context);

    const stream = await api.request('/api/chat', { method: 'POST', headers: { Accept: 'application/x-ndjson' }, body });
    assert.equal(stream.headers.get('Content-Type'), 'application/x-ndjson; charset=utf-8');
    const text = await new Response(stream.body).text();
    const frames = text.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(frames.at(-1), { type: 'result', content: '답변', context });
  });

  it('When no compaction happened Then neither response mentions a context', async () => {
    const api = createApi({ reply: replyWith(undefined), ...rest });
    const json = await api.request('/api/chat', { method: 'POST', body });
    assert.equal('context' in (await json.json()), false);
    const stream = await api.request('/api/chat', { method: 'POST', headers: { Accept: 'application/x-ndjson' }, body });
    const text = await new Response(stream.body).text();
    assert.equal('context' in JSON.parse(text.trim().split('\n').at(-1)!), false);
  });
});
