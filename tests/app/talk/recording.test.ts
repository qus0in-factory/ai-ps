import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingController } from '../../../src/app/talk/recording.ts';
import { initialState, addTurn, activeTutorMood } from '../../../src/app/talk/session-store.ts';
import type { Recorder } from '../../../src/domain/talk/recording.ts';
import type { Result } from '../../../src/domain/chat.ts';
function setup() {
  let view = addTurn(initialState(), '', { mood: 'smile', reply: 'こんにちは。', correction: null, betterExpression: null });
  let complete!: (r: Result<Blob>) => void, tick!: (seconds: number) => void, cancelled = 0;
  const recorder: Recorder = { supported: true, start: async (done, elapsed) => { complete = done; tick = elapsed!; return { ok: true, value: undefined }; }, stop: async () => { const result = { ok: true as const, value: new Blob(['audio'], { type: 'audio/wav' }) }; complete(result); return result; }, cancel: () => { cancelled++; } };
  return { recorder, store: { getState: () => view, setState: (v: typeof view) => { view = v; } }, get cancelled() { return cancelled; }, complete: (r: Result<Blob>) => complete(r), tick: (s: number) => tick(s) };
}
describe('Given recording for a learner-reviewed draft', () => {
  it('When audio stops Then transcribes once, appends to edits and never sends a tutor turn', async () => {
    const s = setup(); let calls = 0;
    const controller = createRecordingController(s.recorder, { transcribe: async () => {
      calls++; assert.equal(s.store.getState().phase, 'transcribing'); assert.equal(activeTutorMood(s.store.getState()), 'think');
      return { ok: true, value: '今日は散歩しました。' };
    } }, s.store);
    const pending = controller.record(); await Promise.resolve(); s.tick(12);
    assert.equal(s.store.getState().recordingSeconds, 12); assert.equal((await controller.record()).ok, false);
    s.store.setState({ ...s.store.getState(), learnerText: '手入力です。' });
    controller.stop(); assert.equal((await pending).ok, true);
    assert.equal(s.store.getState().learnerText, '手入力です。\n今日は散歩しました。');
    assert.equal(s.store.getState().session?.turns.length, 1); assert.equal(s.store.getState().phase, 'idle'); assert.equal(calls, 1);
  });
  it('When cancelling during transcription Then ignores a late response and preserves the draft', async () => {
    const s = setup(); let resolve!: (r: Result<string>) => void;
    const controller = createRecordingController(s.recorder, { transcribe: async () => new Promise(r => { resolve = r; }) }, s.store);
    const pending = controller.record(); await Promise.resolve(); controller.stop();
    for (let i=0;i<5;i++) await Promise.resolve();
    controller.cancel(); assert.equal((await pending).ok, false);
    resolve({ ok: true, value: 'late' }); await Promise.resolve();
    assert.equal(s.store.getState().learnerText, ''); assert.equal(s.store.getState().phase, 'idle'); assert.ok(s.cancelled > 0);
  });
  it('When empty, oversized or failed Then preserves typed text and allows text conversation', async () => {
    for (const result of [{ ok: true as const, value: '' }, { ok: true as const, value: 'x'.repeat(501) }, { ok: false as const, reason: '받아쓰기 실패' }]) {
      const s = setup(); s.store.setState({ ...s.store.getState(), learnerText: '手入力' });
      const controller = createRecordingController(s.recorder, { transcribe: async () => result }, s.store);
      const pending = controller.record(); await Promise.resolve(); controller.stop(); await pending;
      assert.equal(s.store.getState().learnerText, '手入力'); assert.equal(s.store.getState().phase, 'idle'); assert.ok(s.store.getState().error);
    }
  });
  it('When cancelling a pending permission prompt Then immediately unlocks typed input', async () => {
    const s = setup(); s.recorder.start = async () => new Promise(() => {});
    const controller = createRecordingController(s.recorder, { transcribe: async () => { throw Error('must not call'); } }, s.store);
    const pending = controller.record(); assert.equal(s.store.getState().phase, 'requesting-microphone');
    controller.cancel(); assert.equal((await pending).ok, false); assert.equal(s.store.getState().phase, 'idle');
  });
  it('When the session is ended or the microphone is unsupported Then makes no recording request', async () => {
    const s = setup(); let calls = 0; s.recorder.start = async () => { calls++; throw Error(); };
    const controller = createRecordingController(s.recorder, { transcribe: async () => ({ ok: true, value: '' }) }, s.store);
    s.store.setState({ ...s.store.getState(), phase: 'ended' }); assert.equal((await controller.record()).ok, false); assert.equal(calls, 0);
    s.store.setState({ ...s.store.getState(), phase: 'idle' });
    const unsupported = createRecordingController({ ...s.recorder, supported: false }, { transcribe: async () => { throw Error('must not call'); } }, s.store);
    assert.equal((await unsupported.record()).ok, false); assert.match(s.store.getState().error, /텍스트/); assert.equal(calls, 0);
  });
});
