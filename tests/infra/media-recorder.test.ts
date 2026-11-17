import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserRecorder } from '../../src/infra/media-recorder.ts';
import type { RecorderEnvironment } from '../../src/infra/media-recorder.ts';
import type { Result } from '../../src/domain/chat.ts';
function device(supported = ['audio/webm;codecs=opus']) {
  let now = 0, stops = 0, asks = 0;
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const media = { state: 'inactive', mimeType: '', ondataavailable: null as null | ((e: { data: Blob }) => void), onstop: null as null | (() => void), onerror: null as null | (() => void),
    start() { this.state = 'recording'; }, stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) }); this.onstop?.(); } };
  const stream = { getTracks: () => [{ stop: () => { stops++; } }] };
  const env: RecorderEnvironment = { getUserMedia: async () => { asks++; return stream; }, isTypeSupported: mime => supported.includes(mime), createRecorder: (_stream, mime) => { media.mimeType = mime; return media; }, now: () => now,
    schedule: (fn, ms) => { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; } };
  return { env, media, get stops() { return stops; }, get asks() { return asks; }, advance(ms: number) { now += ms; for (const timer of [...timers]) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.fn(); } } };
}
describe('Given a browser microphone adapter', () => {
  it('When choosing a codec and stopping Then uses the first supported MIME and releases all tracks', async () => {
    for (const mime of ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/wav']) {
      const d = device([mime]), recorder = createBrowserRecorder(d.env); let result: Result<Blob> | undefined;
      assert.equal(recorder.supported, true); assert.equal((await recorder.start(v => { result = v; })).ok, true);
      d.advance(1000); const stopped = await recorder.stop(); assert.equal(stopped.ok, true);
      if (stopped.ok) { assert.equal(stopped.value.type, mime); assert.equal(stopped.value.size, 5); }
      assert.equal(result?.ok, true); assert.equal(d.stops, 1);
    }
  });
  it('When reaching 30 seconds Then completes automatically once and cannot record indefinitely', async () => {
    const d = device(), recorder = createBrowserRecorder(d.env); let completions = 0, seconds = 0;
    await recorder.start(() => { completions++; }, value => { seconds = value; });
    d.advance(1000); assert.equal(seconds, 1); d.advance(29000);
    assert.equal(d.media.state, 'inactive'); assert.equal(d.stops, 1); assert.equal(completions, 1);
    recorder.cancel(); assert.equal(completions, 1);
  });
  it('When a device never emits stop Then releases tracks immediately and resolves a bounded failure', async () => {
    const d = device(['audio/webm;codecs=opus', 'audio/mp4']);
    d.media.stop = function () { this.state = 'inactive'; };
    const recorder = createBrowserRecorder(d.env); await recorder.start(() => {});
    assert.equal(d.media.mimeType, 'audio/webm;codecs=opus');
    d.advance(1000); const pending = recorder.stop(); assert.equal(d.stops, 1);
    d.advance(1500); assert.equal((await pending).ok, false);
  });
  it('When permission is denied or codecs are unsupported Then returns Korean guidance without private details', async () => {
    const d = device([]), unsupported = createBrowserRecorder(d.env);
    assert.equal(unsupported.supported, false); assert.equal((await unsupported.start(() => {})).ok, false); assert.equal(d.asks, 0);
    d.env.isTypeSupported = () => true; d.env.getUserMedia = async () => { throw new Error('PRIVATE'); };
    const result = await createBrowserRecorder(d.env).start(() => {}); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  });
  it('When cancelling while permission is pending Then closes a late stream without starting a recorder', async () => {
    const d = device(); let grant!: (stream: Awaited<ReturnType<RecorderEnvironment['getUserMedia']>>) => void;
    d.env.getUserMedia = () => new Promise(resolve => { grant = resolve; });
    const recorder = createBrowserRecorder(d.env), pending = recorder.start(() => {}); recorder.cancel();
    grant({ getTracks: () => [{ stop: () => { d.media.state = 'released'; } }] });
    assert.equal((await pending).ok, false); assert.equal(d.media.state, 'released');
  });
  it('When too short, oversized or failed Then releases the microphone and never returns unusable audio', async () => {
    for (const kind of ['short','large','error']) {
      const d = device(), recorder = createBrowserRecorder(d.env); let result: Result<Blob> | undefined;
      await recorder.start(v => { result = v; });
      if (kind === 'short') await recorder.stop();
      else if (kind === 'large') d.media.ondataavailable?.({ data: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]) });
      else d.media.onerror?.();
      assert.equal(result?.ok, false); assert.equal(d.stops, 1);
    }
  });
});
