import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGameMaster } from '../../../src/app/adventure/game-master.ts';
import { createSession } from '../../../src/domain/adventure/session.ts';
import type { AdventureEvent } from '../../../src/domain/adventure/types.ts';
import type { FunctionCompletionGateway } from '../../../src/domain/completion.ts';
const content = JSON.stringify({ narrative: '너는 창고를 살핀다. 밧줄이 보인다!', statChanges: { health: 2 }, addItems: ['rope'], removeItems: [] });
const answer = { role: 'assistant' as const, content };

describe('Given a bounded adventure game master', () => {
  it('When starting Then ignores all model state changes and emits narrative before state', async () => {
    const events: AdventureEvent[] = [];
    const gm = createGameMaster({ complete: async () => ({ ok: true, value: answer }) });
    const result = await gm.start(e => events.push(e));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value.state, createSession().state);
    assert.equal(events[0]!.kind, 'narrative'); assert.equal(events.at(-1)!.kind, 'state');
  });
  it('When dice are requested Then sends tool results and emits accepted dice narrative state in order', async () => {
    let calls = 0;
    const signal = new AbortController().signal;
    const model: FunctionCompletionGateway = { complete: async (messages, tools, options) => {
      assert.equal(options?.temperature, undefined); assert.notEqual(options?.signal, signal); assert.equal(options?.signal?.aborted, false);
      assert.equal(tools[0]!.name, 'roll_dice');
      if (calls++ === 0) return { ok: true, value: { role: 'assistant', content: null, tool_calls: [{ id: 'd1', type: 'function', function: { name: 'roll_dice', arguments: '{"sides":20,"difficulty":10}' } }] } };
      assert.equal(messages.at(-1)!.role, 'tool');
      return { ok: true, value: answer };
    } };
    const events: AdventureEvent[] = [];
    const session = createSession();
    const result = await createGameMaster(model, { random: () => 0.5, temperature: '' }).turn(session, ' 창고 뒤지기 ', e => events.push(e), signal);
    assert.equal(result.ok, true);
    assert.deepEqual(events.map(e => e.kind), ['accepted','dice','narrative','narrative','state']);
    assert.deepEqual(session, createSession());
    if (result.ok) { assert.equal(result.value.turn, 1); assert.equal(result.value.state.stats.warmth, 49); }
  });
  it('When JSON is invalid Then increments only turn and never reveals the raw output', async () => {
    const events: AdventureEvent[] = [];
    const session = createSession();
    const result = await createGameMaster({ complete: async () => ({ ok: true, value: { role: 'assistant', content: 'SECRET_RAW' } }) }).turn(session, '대기', e => events.push(e));
    assert.deepEqual(result, { ok: true, value: { ...session, turn: 1 } });
    assert.deepEqual(events.map(e => e.kind), ['accepted','invalid']);
    assert.ok(!JSON.stringify(events).includes('SECRET_RAW'));
  });
  it('When dice keep recurring Then stops after four model requests and returns an invalid turn', async () => {
    let calls = 0, dice = 0;
    const gm = createGameMaster({ complete: async () => { calls++; return { ok: true, value: { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'roll_dice', arguments: '{"sides":6,"difficulty":3}' } }] } }; } });
    const result = await gm.turn(createSession(), '탐색', e => { if (e.kind === 'dice') dice++; });
    assert.equal(result.ok, true); assert.equal(calls, 4); assert.equal(dice, 3);
  });
  it('When a model fails or a session is ended Then preserves session and refuses further work', async () => {
    let calls = 0;
    const gm = createGameMaster({ complete: async () => { calls++; return { ok: false, reason: '연결 실패' }; } });
    assert.deepEqual(await gm.turn(createSession(), '대기'), { ok: false, reason: '연결 실패' });
    const ended = createSession(); ended.state.ending = 'missed';
    assert.equal((await gm.turn(ended, '대기')).ok, false); assert.equal(calls, 1);
  });
  it('When a repair is rejected Then retains the full rejection for the next prompt and never sends whitespace-only narrative frames', async () => {
    const events: AdventureEvent[] = [];
    const model: FunctionCompletionGateway = { complete: async () => ({ ok: true, value: { role: 'assistant', content: JSON.stringify({ narrative: '너는 렌즈를 만진다.  \n', statChanges: {}, addItems: [], removeItems: [], repaired: ['lens'] }) } }) };
    const result = await createGameMaster(model).turn(createSession(), 'x'.repeat(200), e => events.push(e));
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(result.value.journal.some(line => line.includes('repair:not-lantern-room')));
    assert.ok(events.filter(e => e.kind === 'narrative').every(e => e.kind !== 'narrative' || !!e.text.trim()));
  });

  it('When starting Then sends no tools; sleep journals the action time and history trimming owns the limit', async () => {
    let calls = 0;
    const gm = createGameMaster({ complete: async (_messages, tools) => {
      if (calls++ === 0) assert.deepEqual(tools, []);
      return { ok: true, value: { role: 'assistant', content: JSON.stringify({ narrative: '너는 잠든다.', sleep: true }) } };
    } });
    assert.equal((await gm.start()).ok, true);
    const session = createSession(); session.state.day = 2; session.state.time = 'night';
    session.recent = Array.from({ length: 4 }, (_, i) => ({ action: '행동' + i, narrative: '서술' + i }));
    const result = await gm.turn(session, '잔다');
    assert.equal(result.ok, true);
    if (result.ok) { assert.match(result.value.journal.at(-1)!, /^2일 night/); assert.equal(result.value.recent.length, 4); assert.equal(result.value.recent[0]!.action, '행동1'); }
  });

});

describe('Given adventure server budgets and canonical sessions', () => {
  it('When a provider emits 1000 calls Then processes at most two per response and bounds the history', async () => {
    let dice = 0, messagesMax = 0;
    const gm = createGameMaster({ complete: async (messages, _tools, options) => {
      messagesMax = Math.max(messagesMax, messages.length);
      assert.equal(options?.max_completion_tokens, 1600);
      return { ok: true, value: { role: 'assistant', content: null, tool_calls: Array.from({ length: 1000 }, (_, i) => ({ id: '' + i, type: 'function', function: { name: 'roll_dice', arguments: '{"sides":6,"difficulty":3}' } })) } };
    } });
    await gm.turn(createSession(), '탐색', e => { if (e.kind === 'dice') dice++; });
    assert.equal(dice, 6); assert.ok(messagesMax < 20);
  });
  it('When the total deadline expires Then fails without waiting for an unresponsive model', async () => {
    let observed: AbortSignal | undefined;
    const gm = createGameMaster({ complete: async (_messages, _tools, options) => { observed = options?.signal; return await new Promise(() => {}); } }, { deadlineMs: 20 });
    const result = await Promise.race([gm.turn(createSession(), '대기'), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('deadline missed')), 500))]);
    assert.equal(result.ok, false); assert.equal(observed?.aborted, true);
  });
  it('When counters are at the boundary Then refuses further calls and generated boundary states validate', async () => {
    const gm = createGameMaster({ complete: async () => ({ ok: true, value: { role: 'assistant', content: '{"narrative":"대기"}' } }) });
    const high = createSession(); high.turn = 1_000_000;
    assert.equal((await gm.turn(high, '대기')).ok, false);
    const invalidDay = createSession(); invalidDay.state.day = 1_000_000;
    assert.equal((await gm.turn(invalidDay, '잠')).ok, false);
    const last = createSession(); last.turn = 999_999;
    const result = await gm.turn(last, '대기');
    assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.turn, 1_000_000);
  });
});

describe('Given optional adventure temperature configuration', () => {
  for (const temperature of [undefined, '', 0.9, '1']) {
    it(`When temperature is ${String(temperature)} Then sends it only when explicitly configured`, async () => {
      let calls = 0;
      const model: FunctionCompletionGateway = { complete: async (_messages, _tools, options) => {
        calls++;
        if (temperature === undefined || temperature === '') assert.equal(Object.hasOwn(options!, 'temperature'), false);
        else assert.equal(options!.temperature, Number(temperature));
        assert.equal(options!.max_completion_tokens, 1600);
        return { ok: true, value: answer };
      } };
      const gm = createGameMaster(model, temperature === undefined ? {} : { temperature });
      assert.equal((await gm.start()).ok, true);
      assert.equal((await gm.turn(createSession(), '대기')).ok, true);
      assert.equal(calls, 2);
    });
  }
});

describe('Given tool-specific adventure options', () => {
  it('When starting without tools Then omits parallel_tool_calls while retaining it for turns', async () => {
    const seen: unknown[] = [];
    const gm = createGameMaster({ complete: async (_messages, tools, options) => {
      seen.push({ tools: tools.length, parallel: Object.hasOwn(options!, 'parallel_tool_calls') });
      return { ok: true, value: answer };
    } });
    await gm.start();
    await gm.turn(createSession(), '대기');
    assert.deepEqual(seen, [{ tools: 0, parallel: false }, { tools: 1, parallel: true }]);
  });
});
