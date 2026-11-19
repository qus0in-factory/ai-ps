import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeSpeaker, type RealtimeSocket } from '../../src/infra/openai-realtime-speech.ts';
import { createOpenAIClient } from '../../src/infra/openai.ts';

class FakeSocket extends EventTarget implements RealtimeSocket {
  readyState = 1;
  sent: Record<string, any>[] = [];
  closes = 0;
  accepts = 0;
  onSend?: (event: Record<string, any>) => void;
  send(raw: string) { const event = JSON.parse(raw); this.sent.push(event); this.onSend?.(event); }
  close() { this.closes++; this.readyState = 3; }
  accept() { this.accepts++; }
  receive(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  complete(transcript = 'こんにちは。') {
    this.receive({ type: 'response.output_audio.delta', delta: btoa('\x00\x80') });
    this.receive({ type: 'response.output_audio.delta', delta: btoa('\xff\x7f') });
    this.receive({ type: 'response.output_audio.done' });
    this.receive({ type: 'response.output_audio_transcript.done', transcript });
    this.receive({ type: 'response.done', response: { status: 'completed' } });
  }
}
function scripted(run: (socket: FakeSocket) => void) {
  const socket = new FakeSocket();
  socket.onSend = event => {
    if (event.type === 'session.update') queueMicrotask(() => socket.receive({ type: 'session.updated' }));
    if (event.type === 'response.create') queueMicrotask(() => run(socket));
  };
  return socket;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('Given a server-side Realtime Japanese speaker', () => {
  it('When the session is configured Then sends one text response request and assembles PCM into WAV', async () => {
    const socket = scripted(s => s.complete());
    const speaker = createRealtimeSpeaker({ apiKey: 'sk-server-only', connect: async (url, headers, signal) => {
      assert.equal(url, 'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini');
      assert.equal(headers.Authorization, 'Bearer sk-server-only'); assert.ok(signal);
      return socket;
    } });
    const result = await speaker.speak('こんにちは。');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.mimeType, 'audio/wav'); assert.equal(result.value.bytes.length, 48);
      assert.deepEqual([...result.value.bytes.subarray(44)], [0, 128, 255, 127]);
    }
    assert.deepEqual(socket.sent.map(e => e.type), ['session.update', 'conversation.item.create', 'response.create']);
    const session = socket.sent[0]!.session;
    assert.equal(session.type, 'realtime'); assert.deepEqual(session.output_modalities, ['audio']);
    assert.deepEqual(session.audio.output, { format: { type: 'audio/pcm', rate: 24000 }, voice: 'coral' });
    assert.equal(session.audio.input.turn_detection, null); assert.equal(session.max_output_tokens, 2048);
    assert.match(session.instructions, /そのまま/); assert.match(session.instructions, /翻訳/);
    assert.deepEqual(socket.sent[1]!.item.content, [{ type: 'input_text', text: 'こんにちは。' }]);
    assert.equal(socket.accepts, 1); assert.equal(socket.closes, 1);
  });
  it('When a shared client is supplied Then uses its base URL and key without retrying the socket', async () => {
    const socket = scripted(s => s.complete());
    const client = createOpenAIClient({ apiKey: 'shared-key', baseUrl: 'https://shared.test/v1/' });
    const speaker = createRealtimeSpeaker({ client, model: 'shared-realtime', connect: async (url, headers) => {
      assert.equal(url, 'wss://shared.test/v1/realtime?model=shared-realtime');
      assert.equal(headers.Authorization, 'Bearer shared-key');
      return socket;
    } });
    assert.equal((await speaker.speak('こんにちは。')).ok, true);
    assert.equal(socket.accepts, 1);
  });
  it('When using the default Workers connection Then upgrades with header auth and accepts the socket', async t => {
    const socket = scripted(s => s.complete());
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      assert.equal(url, 'https://gateway.test/v1/realtime?model=custom-realtime');
      assert.equal(new Headers(init?.headers).get('Upgrade'), 'websocket');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer key'); assert.ok(init?.signal);
      return { status: 101, webSocket: socket };
    });
    const result = await createRealtimeSpeaker({ apiKey: 'key', baseUrl: 'https://gateway.test/v1/', model: 'custom-realtime', voice: 'marin' }).speak('こんにちは。');
    assert.equal(result.ok, true); assert.equal(socket.sent[0]!.session.audio.output.voice, 'marin');
    assert.equal(socket.accepts, 1); assert.equal(socket.closes, 1);
  });
  it('When transcript length drifts Then warns with lengths only and still returns audio', async () => {
    const warnings: unknown[] = [];
    const socket = scripted(s => s.complete('private transcript '.repeat(20)));
    const result = await createRealtimeSpeaker({ apiKey: 'key', connect: async () => socket, warn: entry => warnings.push(entry) }).speak('こんにちは。');
    assert.equal(result.ok, true); assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], { event: 'tts_transcript_length_mismatch', inputLength: 6, outputLength: 380 });
    assert.doesNotMatch(JSON.stringify(warnings), /private|こんにちは|key/);
  });
  it('When provider errors, malformed events, early close or incomplete/empty PCM arrive Then fails safely and closes', async () => {
    const scripts = [
      (s: FakeSocket) => s.receive({ type: 'error', error: { message: 'sk-secret private transcript' } }),
      (s: FakeSocket) => s.dispatchEvent(new MessageEvent('message', { data: '{sk-secret' })),
      (s: FakeSocket) => s.dispatchEvent(new Event('error')),
      (s: FakeSocket) => s.dispatchEvent(new Event('close')),
      (s: FakeSocket) => s.receive({ type: 'response.done', response: { status: 'completed' } }),
      (s: FakeSocket) => { s.receive({ type: 'response.output_audio.delta', delta: 'not base64!' }); },
      (s: FakeSocket) => { s.receive({ type: 'response.output_audio.delta', delta: btoa('x') }); s.receive({ type: 'response.done', response: { status: 'completed' } }); },
      (s: FakeSocket) => { s.receive({ type: 'response.output_audio.delta', delta: btoa('xx') }); s.receive({ type: 'response.done', response: { status: 'incomplete', status_details: { message: 'sk-secret' } } }); },
    ];
    for (const run of scripts) {
      const socket = scripted(run);
      const result = await createRealtimeSpeaker({ apiKey: 'sk-secret', connect: async () => socket }).speak('こんにちは。');
      assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /sk-secret|private|こんにちは/);
      assert.equal(socket.closes, 1);
    }
  });
  it('When audio exceeds 2 MiB including the header Then stops before accepting more data', async () => {
    const socket = scripted(s => {
      const delta = btoa('x'.repeat(65536));
      for (let n = 0; n < 32; n++) s.receive({ type: 'response.output_audio.delta', delta });
      s.complete();
    });
    const result = await createRealtimeSpeaker({ apiKey: 'key', connect: async () => socket }).speak('こんにちは。');
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /크기/);
    assert.equal(socket.closes, 1);
  });
  it('When cancelled while connecting Then settles promptly and closes a late connection', async () => {
    const controller = new AbortController();
    const socket = new FakeSocket();
    let connected!: (socket: RealtimeSocket) => void;
    const pending = createRealtimeSpeaker({ apiKey: 'key', connect: (_url, _headers, signal) => {
      signal?.addEventListener('abort', () => assert.ok(signal.aborted));
      return new Promise(resolve => { connected = resolve; });
    } }).speak('こんにちは。', controller.signal);
    await tick(); controller.abort();
    const result = await pending;
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /중단/);
    connected(socket); await tick(); assert.equal(socket.closes, 1); assert.equal(socket.sent.length, 0);
  });
  it('When the 30 second deadline aborts an open session Then closes and returns timeout', async t => {
    const timeout = new AbortController();
    t.mock.method(AbortSignal, 'timeout', (ms: number) => { assert.equal(ms, 30_000); return timeout.signal; });
    const socket = scripted(() => timeout.abort(new DOMException('private', 'TimeoutError')));
    const result = await createRealtimeSpeaker({ apiKey: 'key', connect: async () => socket }).speak('こんにちは。');
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /시간.*초과/);
    assert.equal(socket.closes, 1);
  });
  it('When no key, invalid text or an already cancelled signal is given Then never connects', async () => {
    const connect = async () => { assert.fail('must not connect'); };
    const speaker = createRealtimeSpeaker({ apiKey: 'key', connect });
    for (const text of ['', ' ', 'x'.repeat(201)]) assert.equal((await speaker.speak(text)).ok, false);
    assert.equal((await speaker.speak('こんにちは。', AbortSignal.abort())).ok, false);
    assert.equal((await createRealtimeSpeaker({ connect }).speak('こんにちは。')).ok, false);
  });
  it('When handshake or send throws Then returns a generic failure and closes any owned socket', async () => {
    const failed = await createRealtimeSpeaker({ apiKey: 'key', connect: async () => { throw Error('sk-secret'); } }).speak('こんにちは。');
    assert.equal(failed.ok, false); assert.doesNotMatch(JSON.stringify(failed), /sk-secret/);
    const socket = new FakeSocket(); socket.onSend = () => { throw Error('sk-secret'); };
    assert.equal((await createRealtimeSpeaker({ apiKey: 'key', connect: async () => socket }).speak('こんにちは。')).ok, false);
    assert.equal(socket.closes, 1);
  });
  it('When a Node socket opens later or an acknowledgement repeats Then requests audio only once', async () => {
    const socket = scripted(s => s.complete()); socket.readyState = 0;
    const pending = createRealtimeSpeaker({ apiKey: 'key', connect: async () => socket }).speak('こんにちは。');
    await tick(); assert.equal(socket.sent.length, 0);
    socket.readyState = 1; socket.dispatchEvent(new Event('open'));
    socket.receive({ type: 'session.updated' });
    assert.equal((await pending).ok, true);
    assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 1);
    assert.equal(socket.closes, 1);
  });
  it('When the connection never resolves Then the deadline still settles and closes any late socket', async t => {
    const timeout = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
    let connected!: (socket: RealtimeSocket) => void;
    const pending = createRealtimeSpeaker({ apiKey: 'key', connect: () => new Promise(resolve => { connected = resolve; }) }).speak('こんにちは。');
    await tick(); timeout.abort(new DOMException('private', 'TimeoutError'));
    const result = await pending;
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.reason, /시간.*초과/);
    const socket = new FakeSocket(); connected(socket); await tick(); assert.equal(socket.closes, 1);
  });
  it('When a Workers upgrade fails Then ignores the HTTP body and closes any returned socket', async t => {
    const socket = new FakeSocket();
    t.mock.method(globalThis, 'fetch', async () => ({ status: 401, webSocket: socket, text: () => assert.fail('must not read diagnostics') }));
    const result = await createRealtimeSpeaker({ apiKey: 'sk-secret' }).speak('こんにちは。');
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /sk-secret/); assert.equal(socket.closes, 1);
  });
  it('When warning or close methods throw Then preserves already completed audio', async () => {
    const socket = scripted(s => s.complete('private transcript '.repeat(20)));
    socket.close = () => { throw Error('private close diagnostic'); };
    const result = await createRealtimeSpeaker({ apiKey: 'key', connect: async () => socket,
      warn: () => { throw Error('private log diagnostic'); } }).speak('こんにちは。');
    assert.equal(result.ok, true);
  });
});
