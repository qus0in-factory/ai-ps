import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTalk } from '../../src/infra/http-talk.ts';
import { createSession } from '../../src/domain/talk/session.ts';
describe('Given a rate-limited Talk client', () => {
  it('When any Talk endpoint returns 429 Then shows the fixed retry message without retrying or exposing the body', async () => {
    let calls = 0;
    const client = createHttpTalk(async () => { calls++; return new Response('private raw diagnostic', { status: 429 }); });
    const results = [await client.respond(createSession()), await client.report(createSession()),
      await client.transcribe(new Blob(['wav'], { type: 'audio/wav' })), await client.speak('こんにちは。')];
    assert.deepEqual(results, Array(4).fill({ ok: false, reason: '잠시 후 다시 시도해 주세요.' }));
    assert.equal(calls, 4);
  });
});
