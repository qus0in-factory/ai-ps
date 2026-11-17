import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTalkStore } from '../../../src/ui/state/talk-store.ts';
import { createTalkController, canSend } from '../../../src/app/talk/session-store.ts';

describe('Given the persisted Talk store wired to a client', () => {
  it('When completing a conversation Then restores the report and ended state without allowing another paid request', async () => {
    const values = new Map<string,string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string,v: string) => { values.set(k,v); }, removeItem: (k: string) => { values.delete(k); } };
    const store = createTalkStore('talk.test', storage);
    const controller = createTalkController({ respond: async () => ({ ok: true, value: { mood: 'neutral' as const, reply: 'こんにちは！', correction: null, betterExpression: null } }), report: async () => ({ ok: true, value: '보고서' }) }, store);
    controller.selectTutor('m'); await controller.start(); await controller.send('Hello'); await controller.finish();
    const saved = JSON.parse(values.get('talk.test')!); assert.deepEqual(Object.keys(saved.state), ['session', 'finished', 'report']); assert.equal(saved.state.finished, true);
    const restored = createTalkStore('talk.test', storage); assert.equal(restored.getState().session?.turns.length, 2);
    assert.equal(restored.getState().session?.tutor, 'm'); assert.equal(restored.getState().selectedTutor, 'm');
    assert.equal(restored.getState().report, '보고서'); assert.equal(restored.getState().phase, 'ended');
    let repeatedCalls = 0;
    const restoredController = createTalkController({ respond: async () => { repeatedCalls++; throw Error('must not call'); }, report: async () => { repeatedCalls++; throw Error('must not call'); } }, restored);
    assert.equal((await restoredController.start()).ok, false);
    assert.equal((await restoredController.send('もう一度')).ok, false);
    assert.equal((await restoredController.finish()).ok, false);
    assert.equal(canSend({ ...restored.getState(), learnerText: 'こんにちは。' }), false);
    assert.equal(repeatedCalls, 0);
    restoredController.reset();
    const afterReset = createTalkStore('talk.test', storage).getState();
    assert.equal(afterReset.session, null); assert.equal(afterReset.report, undefined); assert.equal(afterReset.phase, 'idle');
    controller.reset();
    assert.equal(store.getState().report, undefined); assert.equal(store.getState().session, null);
    controller.selectTutor('f'); await controller.start();
    assert.equal(store.getState().session?.tutor, 'f'); assert.equal(store.getState().report, undefined);
    values.set('bad', JSON.stringify({ state: { session: { version: 1, tutor: 'f', turns: [{}] } }, version: 1 }));
    assert.equal(createTalkStore('bad', storage).getState().session, null);
  });
  it('When restoring legacy or corrupt report data Then resumes only unfinished sessions', () => {
    const session = { version: 1, tutor: 'm', turns: [{ learner: '', tutor: { mood: 'smile', reply: 'こんにちは。', correction: null, betterExpression: null } }] };
    const restore = (state: unknown) => createTalkStore('restore', {
      getItem: () => JSON.stringify({ state, version: 1 }), setItem: () => {}, removeItem: () => {},
    }).getState();
    assert.equal(restore({ session }).phase, 'idle');
    assert.equal(restore({ session, finished: false, report: 'stale' }).report, undefined);
    for (const report of [undefined, '', {}, 'x'.repeat(1501)]) {
      const restored = restore({ session, finished: true, report });
      assert.equal(restored.phase, 'ended'); assert.equal(restored.report, undefined);
      assert.equal(canSend({ ...restored, learnerText: 'こんにちは。' }), false);
    }
    assert.equal(restore({ session: null, finished: true, report: 'orphan' }).report, undefined);
  });
  it('When report generation fails Then reload keeps the conversation resumable without a stored report', async () => {
    let saved = '';
    const storage = { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; }, removeItem: () => {} };
    const store = createTalkStore('failed', storage);
    const controller = createTalkController({ respond: async () => ({ ok: true, value: { mood: 'neutral', reply: 'こんにちは。', correction: null, betterExpression: null } }), report: async () => ({ ok: false, reason: 'failed' }) }, store);
    await controller.start(); await controller.finish();
    assert.equal(JSON.parse(saved).state.finished, false);
    const restored = createTalkStore('failed', storage).getState();
    assert.equal(restored.phase, 'idle'); assert.equal(restored.report, undefined); assert.equal(restored.session?.turns.length, 1);
  });

});
