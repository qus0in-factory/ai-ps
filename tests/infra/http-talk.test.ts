import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTalk } from '../../src/infra/http-talk.ts';
import { createSession } from '../../src/domain/talk/session.ts';
const reply = { reply: 'こんにちは！', correction: null, betterExpression: null };
describe('Given the text Talk HTTP client', () => {
  it('When sending turns and reports Then uses BFF JSON only and validates responses', async () => {
    const paths: string[] = [];
    const client = createHttpTalk(async (path, init) => {
      paths.push(String(path)); assert.equal(init?.method, 'POST'); assert.ok(init?.signal);
      assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
      return Response.json(String(path).endsWith('report') ? { report: '잘했어요.' } : reply);
    });
    assert.deepEqual(await client.respond(createSession()), { ok: true, value: reply });
    assert.deepEqual(await client.report({ version: 1, turns: [{ learner: '', tutor: reply }] }), { ok: true, value: '잘했어요.' });
    assert.deepEqual(paths, ['/api/talk/turn','/api/talk/report']);
    for (const body of [{ reply: '' }, { ...reply, correction: {} }, { ...reply, unexpected: 'secret' }]) {
      assert.equal((await createHttpTalk(async () => Response.json(body)).respond(createSession())).ok, false);
    }
  });
  it('When problem JSON, invalid JSON, transport failure or cancellation arrives Then returns a safe failure', async () => {
    assert.deepEqual(await createHttpTalk(async () => Response.json({ detail: '다시 시도하세요.' }, { status: 502 })).respond(createSession()), { ok: false, reason: '다시 시도하세요.' });
    assert.equal((await createHttpTalk(async () => new Response('private raw')).respond(createSession())).ok, false);
    const caller = new AbortController();
    const pending = createHttpTalk(async () => { caller.abort(); return await new Promise(() => {}); }).respond(createSession(), undefined, caller.signal);
    assert.equal((await pending).ok, false);
  });
});
