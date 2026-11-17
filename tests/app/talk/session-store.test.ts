import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addTurn, fail, setReport, restoreSession, createTalkController } from '../../../src/app/talk/session-store.ts';
import type { TalkView } from '../../../src/app/talk/session-store.ts';
import type { TalkClient, TutorReply } from '../../../src/domain/talk/types.ts';
const reply: TutorReply = { mood: 'neutral' as const, reply: '元気ですか？', correction: null, betterExpression: null };

describe('Given a text conversation view', () => {
  it('When a reply completes Then appends once; failure and corrupt restore do not damage saved turns', () => {
    const view = addTurn(initialState(), '', reply);
    assert.equal(view.session?.turns.length, 1); assert.equal(view.phase, 'idle');
    assert.deepEqual(fail(view, 'network').session, view.session);
    assert.equal(setReport(view, '보고서').phase, 'ended');
    assert.equal(restoreSession({ version: 1, tutor: 'f', turns: 'bad' }), null);
    assert.equal(restoreSession({ version: 1, tutor: 'f', turns: [] }), null);
    assert.deepEqual(restoreSession(view.session), view.session);
  });
  it('When cancelling a pending reply Then ignores late success and preserves the draft and session', async () => {
    let view: TalkView = addTurn(initialState(), '', reply);
    let resolve!: (v: { ok: true; value: TutorReply }) => void;
    let calls = 0;
    const client: TalkClient = { speak: async () => ({ ok: false, reason: 'unused' }), transcribe: async () => ({ ok: false, reason: 'unused' }), respond: async () => { calls++; return await new Promise(r => { resolve = r; }); }, report: async () => ({ ok: true, value: '보고서' }) };
    const controller = createTalkController(client, { getState: () => view, setState: next => { view = next; } });
    const pending = controller.send('家に帰りました。');
    assert.equal(view.phase, 'thinking');
    assert.equal((await controller.send('duplicate')).ok, false); assert.equal(calls, 1);
    controller.cancel(); resolve({ ok: true, value: reply });
    assert.equal((await pending).ok, false); assert.equal(view.session!.turns.length, 1);
    assert.equal(view.learnerText, '家に帰りました。'); assert.equal(view.phase, 'idle');
  });
  it('When starting, speaking and finishing Then uses one call per action and locks the ended session', async () => {
    let view = initialState(); let calls = 0;
    const controller = createTalkController({ respond: async () => { calls++; return { ok: true, value: reply }; }, report: async () => { calls++; return { ok: true, value: '잘한 표현' }; } }, { getState: () => view, setState: next => { view = next; } });
    assert.equal((await controller.start()).ok, true);
    assert.equal((await controller.send('Hello')).ok, true);
    assert.equal((await controller.finish()).ok, true); assert.equal(view.phase, 'ended');
    assert.equal((await controller.finish()).ok, false); assert.equal(calls, 3);
  });
});
