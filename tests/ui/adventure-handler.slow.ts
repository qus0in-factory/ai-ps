import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../src/ui/http/api.ts';
import { createGameMaster } from '../../src/app/adventure/game-master.ts';
import { createSession } from '../../src/domain/adventure/session.ts';
import type { FunctionCompletionGateway } from '../../src/domain/completion.ts';
const unused = async (): Promise<never> => { throw new Error('Unexpected call'); };
const payload = JSON.stringify({ narrative: '너는 문을 연다.', statChanges: {}, addItems: [], removeItems: [] });
function api(model: FunctionCompletionGateway) { return createApi({ reply: unused, queen: { generate: unused }, adventure: createGameMaster(model, { random: () => 0.5 }) }); }
const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

describe('Given the adventure HTTP handlers', () => {
  it('When starting Then emits narrative state result without accepting state changes', async () => {
    const response = await api({ complete: async () => ({ ok: true, value: { role: 'assistant', content: payload } }) }).request('/api/adventure/start', post({}));
    assert.match(response.headers.get('Content-Type')!, /application\/x-ndjson/);
    const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(frames.map(f => f.type === 'event' ? f.event.kind : f.type), ['narrative','state','result']);
    assert.deepEqual(frames.at(-1).value, createSession());
  });
  it('When rolling Then emits accepted dice narrative state result in order', async () => {
    let calls = 0;
    const response = await api({ complete: async () => ({ ok: true, value: calls++ === 0 ? { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'd1', function: { name: 'roll_dice', arguments: '{"sides":6,"difficulty":3}' } }] } : { role: 'assistant', content: payload } }) }).request('/api/adventure/turn', post({ session: createSession(), action: '탐색' }));
    const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(frames.map(f => f.type === 'event' ? f.event.kind : f.type), ['accepted','dice','narrative','state','result']);
  });
  it('When input is invalid or an ended session is sent Then rejects before model calls', async () => {
    const server = api({ complete: unused });
    const ended = createSession(); ended.state.ending = 'dead';
    for (const body of [{}, { session: ended, action: '대기' }, { session: createSession(), action: ' ' }, { session: createSession(), action: 'x'.repeat(201) }]) {
      assert.equal((await server.request('/api/adventure/turn', post(body))).status, 400);
    }
    assert.equal((await server.request('/api/adventure/start')).status, 405);
    assert.equal((await server.request('/api/adventure/start', post({ x: 'x'.repeat(1100) }))).status, 413);
    assert.equal((await server.request('/api/adventure/turn', post({ action: 'x'.repeat(33000) }))).status, 413);
  });
  it('When a model fails Then returns a pre-frame problem for start and a terminal problem after accepted for turn', async () => {
    const server = api({ complete: async () => ({ ok: false, reason: '모델 연결 실패' }) });
    assert.equal((await server.request('/api/adventure/start', post({}))).status, 502);
    const frames = (await (await server.request('/api/adventure/turn', post({ session: createSession(), action: '대기' }))).text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(frames.map(f => f.type), ['event','problem']); assert.equal(frames[1].problem.status, 502);
  });
  it('When an incoming request aborts after accepted Then cancels the model and closes the stream', async () => {
    const controller = new AbortController();
    let modelSignal: AbortSignal | undefined;
    const server = api({ complete: async (_messages, _tools, options) => {
      modelSignal = options?.signal;
      return await new Promise(resolve => options!.signal!.addEventListener('abort', () => resolve({ ok: false, reason: '중단' }), { once: true }));
    } });
    const response = await server.fetch(new Request('https://example.test/api/adventure/turn', { ...post({ session: createSession(), action: '대기' }), signal: controller.signal }));
    const reader = response.body!.getReader();
    await reader.read(); controller.abort();
    const closed = await Promise.race([reader.read().then(r => r.done), new Promise(resolve => setTimeout(() => resolve(false), 150))]);
    assert.equal(modelSignal?.aborted, true); assert.equal(closed, true);
  });

});

describe('Given hostile adventure payloads and serialization failures', () => {
  it('When unknown deep or oversized fields are supplied Then rejects before any model call', async () => {
    const server = api({ complete: unused });
    const base = JSON.stringify(createSession());
    const deep = '['.repeat(10000) + '0' + ']'.repeat(10000);
    for (const session of [base.slice(0,-1) + ',"extra":' + deep + '}', base.replace('"state":{', '"state":{"extra":' + deep + ','), base.replace('"stats":{', '"stats":{"extra":"' + 'x'.repeat(24000) + '",')]) {
      const response = await server.request('/api/adventure/turn', { method: 'POST', body: '{"session":' + session + ',"action":"대기"}' });
      assert.equal(response.status, 400);
    }
  });
  it('When a final result cannot be serialized Then emits a safe problem and closes', async () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const server = createApi({ reply: unused, queen: { generate: unused }, adventure: {
      start: unused,
      turn: async (_session, action, onEvent) => { onEvent?.({ kind: 'accepted', action }); return { ok: true, value: cyclic as never }; },
    } });
    const response = await server.request('/api/adventure/turn', post({ session: createSession(), action: '대기' }));
    const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(frames.map(f => f.type), ['event','problem']); assert.equal(frames[1].problem.status, 500);
  });
});
