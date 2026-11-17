import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkTalkRateLimit } from '../../../src/app/talk/rate-limit.ts';
describe('Given Talk rate limiting bindings', () => {
  it('When audio or text routes arrive Then selects the shared group and passes only the actor key', async () => {
    const calls: string[] = [];
    const limits = {
      TALK_AUDIO_LIMIT: { limit: async ({ key }: { key: string }) => { calls.push('audio:' + key); return { success: true }; } },
      TALK_TURN_LIMIT: { limit: async ({ key }: { key: string }) => { calls.push('turn:' + key); return { success: false }; } },
    };
    for (const route of ['speech', 'transcribe']) assert.equal(await checkTalkRateLimit('/api/talk/' + route, 'test-ip', limits), 'allowed');
    for (const route of ['turn', 'report']) assert.equal(await checkTalkRateLimit('/api/talk/' + route, 'test-ip', limits), 'limited');
    assert.deepEqual(calls, ['audio:test-ip', 'audio:test-ip', 'turn:test-ip', 'turn:test-ip']);
  });
  it('When unbound or outside Talk Then passes, but a bound limiter failure stops paid processing', async () => {
    assert.equal(await checkTalkRateLimit('/api/talk/speech', 'anon', {}), 'allowed');
    const limits = { TALK_AUDIO_LIMIT: { limit: async () => { throw Error('private-ip'); } } };
    assert.equal(await checkTalkRateLimit('/api/chat', 'anon', limits), 'allowed');
    assert.equal(await checkTalkRateLimit('/api/talk/speech', 'anon', limits), 'unavailable');
  });
});
