import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, normalizeSession } from '../../../src/domain/talk/session.ts';
import { parseTutorReply, FALLBACK_REPLY } from '../../../src/domain/talk/reply.ts';
import { buildTutorMessages } from '../../../src/domain/talk/prompt.ts';
import { TALK_FIXED_PHRASES } from '../../../src/domain/talk/speech-cache.ts';

describe('Given tutor portraits and legacy conversation sessions', () => {
  it('When a model chooses a mood Then accepts only the six portrait enums and defaults all other values', () => {
    for (const mood of ['neutral','smile','think','surprised','encourage','confused']) {
      assert.equal(parseTutorReply(JSON.stringify({ reply: 'こんにちは。', mood })).mood, mood);
    }
    for (const mood of [undefined, null, 'happy', '../secret', {}, 2]) {
      assert.equal(parseTutorReply(JSON.stringify({ reply: 'こんにちは。', mood })).mood, 'neutral');
    }
    assert.equal(parseTutorReply('bad').mood, 'neutral');
  });
  it('When restoring old sessions Then fills portrait defaults; forged enums are rejected', () => {
    const old = { version: 1, turns: [{ learner: '', tutor: { reply: 'こんにちは。', correction: null, betterExpression: null } }] };
    const restored = normalizeSession(old)!;
    assert.equal(restored.tutor, 'f'); assert.equal(restored.turns[0]!.tutor.mood, 'neutral');
    assert.equal(createSession('m').tutor, 'm');
    for (const tutor of ['../f', null, {}, 0]) assert.equal(normalizeSession({ ...old, tutor }), undefined);
    assert.equal(normalizeSession({ ...old, turns: [{ ...old.turns[0], tutor: { ...old.turns[0]!.tutor, mood: 'happy' } }] }), undefined);
  });
  it('When greeting or falling back Then uses the shared fixed phrases verbatim', () => {
    assert.equal(FALLBACK_REPLY, TALK_FIXED_PHRASES.repeat);
    assert.ok(buildTutorMessages(createSession()).at(-1)!.content.includes(TALK_FIXED_PHRASES.greeting));
    assert.match(buildTutorMessages(createSession())[0]!.content, /mood/);
  });
});
