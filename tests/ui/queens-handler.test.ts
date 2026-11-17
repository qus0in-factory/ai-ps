import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../src/ui/http/api.ts';
import type { QueensGenerator } from '../../src/domain/queens/generation.ts';

async function request(body: string, generator: QueensGenerator, method = 'POST') {
  const api = createApi({ adventure: { start: async () => { throw new Error('Unexpected adventure'); }, turn: async () => { throw new Error('Unexpected adventure'); } }, reply: async () => { throw new Error('Unexpected chat request'); }, queens: generator, talk: { tutor: { respond: async () => ({ ok: false as const, reason: 'unused' }), report: async () => ({ ok: false as const, reason: 'unused' }) } } });
  const response = await api.request('/api/queens/generate', {
    method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body }),
  });
  return { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') }, payload: await response.text() };
}

describe('Given the Queens generation endpoint', () => {
  it('When input is invalid Then responds with Problem Details before any model call', async () => {
    const generator: QueensGenerator = { generate: async () => { throw new Error('Must not generate'); } };
    for (const body of ['{invalid', '{"size":4}', '{"size":10}', '{}']) {
      const result = await request(body, generator);
      assert.equal(result.status, 400);
      assert.equal(result.headers['Content-Type'], 'application/problem+json');
      assert.equal(JSON.parse(result.payload).instance, '/api/queens/generate');
    }
    assert.equal((await request('{}', generator, 'GET')).status, 405);
  });
  it('When work bounds are exhausted Then streams progress and a terminal Problem Details frame', async () => {
    const result = await request('{"size":5}', { generate: async (size, onEvent, signal) => {
      assert.equal(size, 5); assert.ok(signal instanceof AbortSignal);
      onEvent?.({ kind: 'placement' });
      return { ok: false, reason: '알고리즘 작업 한도에 도달했습니다.' };
    } });
    const frames = result.payload.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(frames[0].type, 'event');
    assert.equal(frames[1].type, 'problem');
    assert.equal(frames[1].problem.status, 502);
    assert.equal(frames[1].problem.instance, '/api/queens/generate');
    assert.equal(result.headers['Content-Type'], 'application/x-ndjson; charset=utf-8');
  });
});
