import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../../src/ui/http/api.ts';

const unusedReply = async () => { throw new Error('Must not call chat'); };
const unusedQueens = { generate: async () => { throw new Error('Must not generate'); } };

describe('Given the Hono API', () => {
  it('When the old singular Queens API is requested Then returns 404 without an alias', async () => {
    const api = createApi({
      adventure: { start: unusedReply, turn: unusedReply }, reply: unusedReply, queens: unusedQueens,
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
    const response = await createApi({ adventure: { start: async () => { throw new Error('Unexpected adventure'); }, turn: async () => { throw new Error('Unexpected adventure'); } }, reply: unusedReply, queens: unusedQueens }).request('/api/missing');
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
        onEvent?.({ kind: 'attempt', attempt: 1, retry: 0 });
        await new Promise<void>(resolve => signal!.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
        return { ok: false, reason: '중단됨' };
      },
    } });
    const response = await api.request('/api/queens/generate', { method: 'POST', body: '{"size":5}' });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await stopped;
    assert.equal(generationSignal!.aborted, true);
  });
});
