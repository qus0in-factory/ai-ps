import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTalkStore } from '../../../src/ui/state/talk-store.ts';
import { createTalkController } from '../../../src/app/talk/session-store.ts';

describe('Given the persisted Talk store wired to a client', () => {
  it('When completing a conversation Then persists only the session and restores safely', async () => {
    const values = new Map<string,string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string,v: string) => { values.set(k,v); }, removeItem: (k: string) => { values.delete(k); } };
    const store = createTalkStore('talk.test', storage);
    const controller = createTalkController({ respond: async () => ({ ok: true, value: { mood: 'neutral' as const, reply: 'こんにちは！', correction: null, betterExpression: null } }), report: async () => ({ ok: true, value: '보고서' }) }, store);
    controller.selectTutor('m'); await controller.start(); await controller.send('Hello'); await controller.finish();
    const saved = JSON.parse(values.get('talk.test')!); assert.deepEqual(Object.keys(saved.state), ['session']);
    const restored = createTalkStore('talk.test', storage); assert.equal(restored.getState().session?.turns.length, 2);
    assert.equal(restored.getState().session?.tutor, 'm'); assert.equal(restored.getState().selectedTutor, 'm');
    assert.equal(restored.getState().report, undefined); assert.equal(restored.getState().phase, 'idle');
    controller.reset();
    assert.equal(store.getState().report, undefined); assert.equal(store.getState().session, null);
    controller.selectTutor('f'); await controller.start();
    assert.equal(store.getState().session?.tutor, 'f'); assert.equal(store.getState().report, undefined);
    values.set('bad', JSON.stringify({ state: { session: { version: 1, tutor: 'f', turns: [{}] } }, version: 1 }));
    assert.equal(createTalkStore('bad', storage).getState().session, null);
  });
});
