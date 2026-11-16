import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpChat } from '../../src/infra/http-chat.ts';

const messages = [{ role: 'user' as const, content: '안녕' }];

describe('Given the HTTP chat adapter', () => {
  it('When receiving problem details Then displays detail or falls back to title', async () => {
    for (const [problem, reason] of [
      [{ type: 'about:blank', title: 'Bad Gateway', status: 502, detail: '모델 연결 실패', instance: '/api/chat' }, '모델 연결 실패'],
      [{ title: 'Bad Gateway', detail: 123 }, 'Bad Gateway'],
    ] as const) {
      const chat = createHttpChat(async (_url, init) => {
        assert.match((init!.headers as Record<string, string>).Accept!, /application\/problem\+json/);
        return Response.json(problem, { status: 502, headers: { 'Content-Type': 'application/problem+json' } });
      });
      assert.deepEqual(await chat.complete(messages), { ok: false, reason });
    }
  });

  it('When an intermediary returns HTML Then preserves an HTTP error instead of a network error', async () => {
    const chat = createHttpChat(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    assert.deepEqual(await chat.complete(messages), { ok: false, reason: '응답을 가져오지 못했습니다. (HTTP 502)' });
  });
});
