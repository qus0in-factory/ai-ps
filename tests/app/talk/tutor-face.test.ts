import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTalkController, initialState, activeTutorMood, restoreSession } from '../../../src/app/talk/session-store.ts';
import { createTutor } from '../../../src/app/talk/tutor.ts';
import { createSession } from '../../../src/domain/talk/session.ts';
import { TALK_FIXED_PHRASES } from '../../../src/domain/talk/speech-cache.ts';

describe('Given a chosen conversation tutor', () => {
  it('When starting, continuing and resetting Then locks the tutor to the session and shows think only while pending', async () => {
    let view = initialState();
    const controller = createTalkController({ respond: async session => {
      assert.equal(session.tutor, 'm'); assert.equal(activeTutorMood(view), 'think');
      controller.selectTutor('f');
      return { ok: true, value: { reply: 'いいですね。', mood: 'encourage', correction: null, betterExpression: null } };
    }, report: async () => ({ ok: true, value: '보고서' }) }, { getState: () => view, setState: v => { view = v; } });
    controller.selectTutor('m'); await controller.start();
    assert.equal(view.session!.tutor, 'm'); assert.equal(activeTutorMood(view), 'encourage');
    controller.selectTutor('f'); await controller.send('今日は散歩しました。');
    assert.equal(view.session!.tutor, 'm'); assert.equal(restoreSession(view.session)!.tutor, 'm');
    controller.reset(); assert.equal(view.session, null); controller.selectTutor('f'); assert.equal(view.selectedTutor, 'f');
  });
  it('When a model paraphrases the opening Then the successful greeting still equals the cached phrase exactly', async () => {
    const tutor = createTutor({ complete: async () => ({ ok: true, value: { role: 'assistant', content: '{"reply":"別の挨拶","mood":"smile","correction":"잘못된 교정","betterExpression":"別の挨拶"}' } }) });
    assert.deepEqual(await tutor.respond(createSession('m')), { ok: true, value: { reply: TALK_FIXED_PHRASES.greeting, mood: 'smile', correction: null, betterExpression: null } });
  });
});
