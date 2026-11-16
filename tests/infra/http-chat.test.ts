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

describe('Given streaming agent progress', () => {
  it('When a final frame arrives without connection closure Then finishes immediately', { timeout: 1000 }, async () => {
    for (const frame of [
      { type: 'result', content: '완료된 답변입니다.' },
      { type: 'problem', problem: { detail: '조회에 실패했습니다.' } },
    ]) {
      let cancelled = false;
      const chat = createHttpChat(async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(frame) + '\n')); },
        cancel() { cancelled = true; },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
      assert.deepEqual(await chat.complete(messages), frame.type === 'result'
        ? { ok: true, value: frame.content } : { ok: false, reason: frame.problem!.detail });
      assert.equal(cancelled, true);
    }
  });

  it('When a stream stalls Then times out and cancels the body', { timeout: 1000 }, async () => {
    let cancelled = false;
    const chat = createHttpChat(async () => new Response(new ReadableStream({
      start() {},
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } }), 20);
    const result = await chat.complete(messages);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /시간.*초과/);
    assert.equal(cancelled, true);
  });

  it('When JSON and Korean text span network chunks Then emits steps and returns the final answer', async () => {
    const step = { kind: 'thought', summary: '서울의 온도를 확인합니다.' };
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'step', step }) + '\n' + JSON.stringify({ type: 'result', content: '부산이 5°C 높습니다.' }) + '\n');
    const received: unknown[] = [];
    const chat = createHttpChat(async () => new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    assert.deepEqual(await chat.complete(messages, (step) => received.push(step)), { ok: true, value: '부산이 5°C 높습니다.' });
    assert.deepEqual(received, [step]);
  });

  it('When a stream reports a problem Then returns its detail', async () => {
    const chat = createHttpChat(async () => new Response(JSON.stringify({ type: 'problem', problem: {
      type: 'about:blank', title: 'Bad Gateway', status: 502, detail: '반복 호출을 중단했습니다.', instance: '/api/chat',
    } }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } }));
    assert.deepEqual(await chat.complete(messages), { ok: false, reason: '반복 호출을 중단했습니다.' });
  });
});
