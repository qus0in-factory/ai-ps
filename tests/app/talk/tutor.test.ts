import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTutor, parseTurnRequest, parseReportRequest } from '../../../src/app/talk/tutor.ts';
import { createSession } from '../../../src/domain/talk/session.ts';

describe('Given the text tutor application', () => {
  it('When greeting, responding and reporting Then makes one bounded call each without temperature or tools', async () => {
    const calls: unknown[] = [];
    const tutor = createTutor({ complete: async (messages, options) => {
      calls.push(options); assert.equal(Object.hasOwn(options!, 'temperature'), false);
      assert.equal(options?.reasoning_effort, 'none'); assert.equal(options?.timeoutMs, 60_000);
      assert.equal(options?.max_completion_tokens, 800); assert.ok(options?.signal);
      return { ok: true, value: { role: 'assistant', content: options?.response_format ? '{"reply":"今日はどうでしたか？","correction":null,"betterExpression":null}' : '잘한 표현\n다음에는 과거형을 연습하세요.' } };
    } });
    const session = createSession(); const greeting = await tutor.respond(session);
    assert.equal(greeting.ok, true); if (!greeting.ok) return;
    session.turns.push({ learner: '', tutor: greeting.value });
    assert.equal((await tutor.respond(session, ' 今日は散歩しました。 ')).ok, true);
    assert.equal((await tutor.report(session)).ok, true); assert.equal(calls.length, 3);
    assert.equal(session.turns.length, 1);
  });
  it('When input is invalid or the history is full Then never calls the model', async () => {
    let calls = 0; const tutor = createTutor({ complete: async () => { calls++; throw Error('must not call'); } });
    assert.equal(parseTurnRequest({ session: createSession(), text: '  ' }).ok, false);
    assert.equal(parseTurnRequest({ session: createSession(), extra: 'x' }).ok, false);
    assert.equal(parseReportRequest({ session: createSession() }).ok, false);
    assert.equal((await tutor.respond({ version: 1, tutor: 'f', turns: Array.from({ length: 40 }, () => ({ learner: 'Hi', tutor: { mood: 'neutral' as const, reply: 'こんにちは！', correction: null, betterExpression: null } })) }, 'Hello')).ok, false);
    assert.equal((await tutor.report(createSession())).ok, false); assert.equal(calls, 0);
  });
  it('When the provider fails, throws or returns an empty report Then exposes no raw details', async () => {
    const session = { version: 1 as const, tutor: 'f' as const, turns: [{ learner: 'Hi', tutor: { mood: 'neutral' as const, reply: 'Hello', correction: null, betterExpression: null } }] };
    for (const kind of ['error','throw','empty']) {
      const tutor = createTutor({ complete: async () => {
        if (kind === 'throw') throw Error('SECRET_KEY user text');
        if (kind === 'error') return { ok: false, reason: 'SECRET_KEY provider message' };
        return { ok: true, value: { role: 'assistant', content: ' ' } };
      } });
      const result = await tutor.report(session); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes('SECRET_KEY'));
    }
  });
  it('When cancelled or the deadline expires Then stops even if the model ignores the signal', async t => {
    for (const kind of ['cancel','deadline']) {
      const caller = new AbortController(), deadline = new AbortController();
      const mock = t.mock.method(AbortSignal, 'timeout', (ms: number) => { assert.equal(ms, 60000); return deadline.signal; });
      let signal: AbortSignal | undefined;
      const tutor = createTutor({ complete: async (_messages, options) => { signal = options?.signal; return await new Promise(() => {}); } });
      const pending = tutor.respond(createSession(), undefined, caller.signal);
      (kind === 'cancel' ? caller : deadline).abort();
      assert.equal((await pending).ok, false); assert.equal(signal?.aborted, true); mock.mock.restore();
    }
  });
});
