import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, isAdventureSession } from '../../../src/domain/adventure/session.ts';
import { applyTurn } from '../../../src/domain/adventure/rules.ts';
import { parseTurnOutcome } from '../../../src/domain/adventure/outcome.ts';
import { rollDice } from '../../../src/domain/adventure/dice.ts';
import { trimHistory, buildTurnMessages } from '../../../src/domain/adventure/history.ts';
import type { TurnOutcome } from '../../../src/domain/adventure/types.ts';
const outcome = (patch: Partial<TurnOutcome> = {}): TurnOutcome => ({ narrative: '파도가 밀려온다.', statChanges: {}, addItems: [], removeItems: [], ...patch });

describe('Given deterministic lighthouse rules', () => {
  it('When acting Then copies the start state and applies basic costs and storm-night costs', () => {
    const { state } = createSession();
    assert.deepEqual(state.stats, { health: 90, warmth: 55, focus: 70 });
    const next = applyTurn(state, outcome(), { diceUsed: false });
    assert.deepEqual(next.state.stats, { health: 90, warmth: 49, focus: 66 });
    assert.equal(state.stats.warmth, 55);
    state.time = 'night';
    assert.equal(applyTurn(state, outcome(), { diceUsed: false }).state.stats.warmth, 43);
  });
  it('When depleted Then applies penalties before sleeping and cannot revive the dead', () => {
    const { state } = createSession();
    state.stats = { health: 10, warmth: 0, focus: 0 };
    const result = applyTurn(state, outcome({ sleep: true }), { diceUsed: false });
    assert.equal(result.state.ending, 'dead');
    assert.equal(result.state.stats.health, 0);
    assert.equal(result.applied.slept, false);
  });
  it('When deltas exceed limits Then clamps integers, ignores fractions and records rejection', () => {
    const result = applyTurn(createSession().state, outcome({ statChanges: { health: 500, warmth: -500, focus: 1.2 } }), { diceUsed: false });
    assert.deepEqual(result.state.stats, { health: 100, warmth: 9, focus: 66 });
    assert.equal(result.applied.rejected.length, 3);
  });
  it('When repairing Then requires the room, owned part, and positive focus and consumes the item once', () => {
    const { state } = createSession();
    assert.ok(applyTurn(state, outcome({ repaired: ['lens'] }), { diceUsed: false }).applied.rejected.includes('repair:not-lantern-room'));
    state.location = 'lantern-room';
    assert.ok(applyTurn(state, outcome({ repaired: ['lens'] }), { diceUsed: false }).applied.rejected.includes('repair:no-part'));
    state.inventory.push('spare-lens'); state.stats.focus = 0;
    assert.ok(applyTurn(state, outcome({ repaired: ['lens'] }), { diceUsed: false }).applied.rejected.includes('repair:no-focus'));
    state.stats.focus = 70;
    const repaired = applyTurn(state, outcome({ repaired: ['lens', 'lens'] }), { diceUsed: false });
    assert.equal(repaired.state.repairs.lens, true);
    assert.ok(!repaired.state.inventory.includes('spare-lens'));
    assert.deepEqual(repaired.applied.repaired, ['lens']);
  });
  it('When sleeping outside quarters Then refuses sleep; day six dawn misses the ship', () => {
    const { state } = createSession(); state.location = 'shore';
    assert.ok(applyTurn(state, outcome({ sleep: true }), { diceUsed: false }).applied.rejected.includes('sleep:not-quarters'));
    state.location = 'quarters'; state.day = 5;
    const result = applyTurn(state, outcome({ sleep: true }), { diceUsed: false });
    assert.equal(result.state.day, 6); assert.equal(result.state.time, 'dawn'); assert.equal(result.state.ending, 'missed');
  });
  it('When lighting the lamp Then requires all repairs, the room, and the deadline', () => {
    for (const ready of [true, false]) for (const room of [true, false]) for (const day of [5, 6]) {
      const { state } = createSession(); state.day = day;
      state.repairs = { lens: ready, clockwork: ready, oil: ready }; state.location = room ? 'lantern-room' : 'shore';
      assert.equal(applyTurn(state, outcome({ lampLit: true }), { diceUsed: false }).state.ending === 'cleared', ready && room && day === 5);
    }
  });
});

describe('Given untrusted sessions and model outcomes', () => {
  it('When parsing Then accepts a wrapped object but rejects missing fields and unsafe item IDs', () => {
    assert.equal(parseTurnOutcome('```json\n' + JSON.stringify(outcome()) + '\n```').ok, true);
    assert.equal(parseTurnOutcome('{"narrative":"x"}').ok, true);
    assert.equal(parseTurnOutcome(JSON.stringify(outcome({ addItems: ['<script>'] }))).ok, false);
    assert.equal(isAdventureSession(createSession()), true);
    assert.equal(isAdventureSession({ ...createSession(), state: { ...createSession().state, stats: { health: Infinity, warmth: 0, focus: 0 } } }), false);
  });
  it('When rolling Then validates inputs and uses the injected random value', () => {
    assert.deepEqual(rollDice(20, 12, () => 0.65), { ok: true, value: { sides: 20, difficulty: 12, roll: 14, success: true } });
    assert.equal(rollDice(1, 1, () => 0).ok, false);
    assert.equal(rollDice(6, 7, () => 0).ok, false);
  });
  it('When trimming Then bounds history and constructs no tool messages', () => {
    const session = createSession();
    session.journal = Array.from({ length: 12 }, (_, i) => 'entry ' + i);
    session.recent = Array.from({ length: 7 }, (_, i) => ({ action: '행동 ' + i, narrative: 'x'.repeat(500) }));
    const trimmed = trimHistory(session);
    assert.equal(trimmed.recent.length, 4); assert.equal(trimmed.journal.length, 12);
    assert.ok(trimmed.recent.every(record => record.narrative.length <= 400));
    assert.ok(trimmed.journal.every(line => line.length <= 80));
    const messages = buildTurnMessages(trimmed, ' 둘러보기 ');
    assert.equal(messages[0]!.role, 'system'); assert.ok(messages.every(message => message.role !== 'tool'));
    assert.ok(messages.at(-1)!.content!.includes('[현재 상태 JSON]'));
  });
});

describe('Given reviewed time, sleep, and heating rules', () => {
  it('When taking three valid actions Then advances one phase and never regresses', () => {
    let state = createSession().state;
    for (let i = 0; i < 2; i++) state = applyTurn(state, outcome(), { diceUsed: false }).state;
    assert.equal(state.time, 'dawn');
    state = applyTurn(state, outcome(), { diceUsed: false }).state;
    assert.equal(state.time, 'day');
    const regression = applyTurn(state, outcome({ time: 'dawn' }), { diceUsed: false });
    assert.equal(regression.state.time, 'day'); assert.ok(regression.applied.rejected.includes('time:regress'));
    state.time = 'night';
    for (let i = 0; i < 6; i++) state = applyTurn(state, outcome(), { diceUsed: false }).state;
    assert.equal(state.time, 'night');
  });
  it('When sleeping in quarters Then waives basic costs and a carried blanket adds warmth', () => {
    const state = createSession().state; state.time = 'night';
    const sleep = applyTurn(state, outcome({ sleep: true }), { diceUsed: false });
    assert.equal(sleep.applied.stats.warmth, 0); assert.equal(sleep.applied.stats.focus, 30);
    state.inventory.push('blanket');
    assert.equal(applyTurn(state, outcome({ sleep: true }), { diceUsed: false }).applied.stats.warmth, 10);
  });
  it('When the heating delta is present Then retains it; failed heating with no fuel has only basic consumption', () => {
    const parsed = parseTurnOutcome(JSON.stringify(outcome({ narrative: '너는 장작을 태워 몸을 녹인다.', statChanges: { warmth: 20 }, removeItems: ['driftwood'] })));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const state = createSession().state; state.inventory.push('driftwood');
    assert.equal(applyTurn(state, parsed.value, { diceUsed: false }).applied.stats.warmth, 14);
    assert.equal(applyTurn(createSession().state, outcome({ narrative: '땔감이 없어 불이 꺼진다.' }), { diceUsed: false }).applied.stats.warmth, -6);
  });
  it('When only narrative is returned Then normalizes missing fields but rejects invalid supplied values', () => {
    assert.deepEqual(parseTurnOutcome('{"narrative":"파도가 친다."}'), { ok: true, value: { narrative: '파도가 친다.', statChanges: {}, addItems: [], removeItems: [] } });
    for (const extra of [{ statChanges: null }, { addItems: 'rope' }, { removeItems: [4] }]) assert.equal(parseTurnOutcome(JSON.stringify({ narrative: '파도', ...extra })).ok, false);
  });
});
