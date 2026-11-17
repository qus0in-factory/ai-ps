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
    const next = applyTurn(state, outcome());
    assert.deepEqual(next.state.stats, { health: 90, warmth: 49, focus: 66 });
    assert.equal(state.stats.warmth, 55);
    state.time = 'night';
    assert.equal(applyTurn(state, outcome()).state.stats.warmth, 43);
  });
  it('When depleted Then applies penalties before sleeping and cannot revive the dead', () => {
    const { state } = createSession();
    state.stats = { health: 10, warmth: 0, focus: 0 };
    const result = applyTurn(state, outcome({ sleep: true }));
    assert.equal(result.state.ending, 'dead');
    assert.equal(result.state.stats.health, 0);
    assert.equal(result.applied.slept, false);
  });
  it('When deltas exceed limits Then clamps integers, ignores fractions without rejection metadata', () => {
    const result = applyTurn(createSession().state, outcome({ statChanges: { health: 500, warmth: -500, focus: 1.2 } }));
    assert.deepEqual(result.state.stats, { health: 100, warmth: 9, focus: 66 });

  });
  it('When repairing Then requires the room, owned part, and positive focus and consumes the item once', () => {
    const { state } = createSession();
    assert.equal(applyTurn(state, outcome({ repaired: ['lens'] })).state.repairs.lens, false);
    state.location = 'lantern-room';
    assert.equal(applyTurn(state, outcome({ repaired: ['lens'] })).state.repairs.lens, false);
    state.inventory.push('spare-lens'); state.stats.focus = 0;
    assert.equal(applyTurn(state, outcome({ repaired: ['lens'] })).state.repairs.lens, false);
    state.stats.focus = 70;
    const repaired = applyTurn(state, outcome({ repaired: ['lens', 'lens'] }));
    assert.equal(repaired.state.repairs.lens, true);
    assert.ok(!repaired.state.inventory.includes('spare-lens'));
    assert.deepEqual(repaired.applied.repaired, ['lens']);
  });
  it('When lighting the lamp Then requires all repairs, the room, and the deadline', () => {
    for (const ready of [true, false]) for (const room of [true, false]) for (const day of [5, 6]) {
      const { state } = createSession(); state.day = day;
      state.repairs = { lens: ready, clockwork: ready, oil: ready }; state.location = room ? 'lantern-room' : 'shore';
      assert.equal(applyTurn(state, outcome({ lampLit: true })).state.ending === 'cleared', ready && room && day === 5);
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
    session.recent = Array.from({ length: 7 }, (_, i) => ({ action: '행동 ' + i, narrative: 'x'.repeat(500) }));
    const trimmed = trimHistory(session);
    assert.equal(trimmed.recent.length, 7);
    assert.ok(trimmed.recent.every(record => record.narrative.length <= 400));
    const messages = buildTurnMessages(trimmed, ' 둘러보기 ');
    assert.equal(messages[0]!.role, 'system'); assert.ok(messages.every(message => message.role !== 'tool'));
    assert.ok(messages.at(-1)!.content!.includes('[현재 상태 JSON]'));
  });
});

describe('Given model-reported changes', () => {
  it('When the heating delta is present Then retains it; failed heating with no fuel has only basic consumption', () => {
    const parsed = parseTurnOutcome(JSON.stringify(outcome({ narrative: '너는 장작을 태워 몸을 녹인다.', statChanges: { warmth: 20 }, removeItems: ['driftwood'] })));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const state = createSession().state; state.inventory.push('driftwood');
    assert.equal(applyTurn(state, parsed.value).applied.stats.warmth, 14);
    assert.equal(applyTurn(createSession().state, outcome({ narrative: '땔감이 없어 불이 꺼진다.' })).applied.stats.warmth, -6);
  });
  it('When only narrative is returned Then normalizes missing fields but rejects invalid supplied values', () => {
    assert.deepEqual(parseTurnOutcome('{"narrative":"파도가 친다."}'), { ok: true, value: { narrative: '파도가 친다.', statChanges: {}, addItems: [], removeItems: [] } });
    for (const extra of [{ statChanges: null }, { addItems: 'rope' }, { removeItems: [4] }]) assert.equal(parseTurnOutcome(JSON.stringify({ narrative: '파도', ...extra })).ok, false);
  });
});


describe('Given the slim adventure contract', () => {
  it('When the model reports day and time Then applies valid values without automatic progression', () => {
    let state = createSession().state;
    for (let i = 0; i < 4; i++) state = applyTurn(state, outcome()).state;
    assert.equal(state.time, 'dawn');
    state.time = 'night';
    const result = applyTurn(state, outcome({ time: 'day', day: 2 }));
    assert.equal(result.state.time, 'day'); assert.equal(result.state.day, 2);
    assert.ok(!('rejected' in result.applied));
    assert.equal(parseTurnOutcome(JSON.stringify(outcome({ day: 7 }))).ok, false);
  });
  it('When sleeping Then retains basic consumption and recovery without blanket bonuses', () => {
    const state = createSession().state; state.stats.focus = 40; state.inventory.push('blanket');
    const result = applyTurn(state, outcome({ sleep: true }));
    assert.equal(result.applied.stats.warmth, -6); assert.equal(result.applied.stats.focus, 36);
    assert.equal(result.state.day, 2);
    state.day = 5;
    assert.equal(applyTurn(state, outcome({ sleep: true })).state.ending, 'missed');
  });
  it('When building history Then includes only recent original turns and the current state', () => {
    const session = createSession();
    assert.ok(!('journal' in session)); assert.ok(!('timeActions' in session.state));
    session.recent = Array.from({ length: 5 }, (_, i) => ({ action: '행동' + i, narrative: '서술' + i }));
    const trimmed = trimHistory(session);
    const messages = buildTurnMessages(trimmed, '대기');
    assert.equal(trimmed.recent[0]!.action, '행동0'); assert.equal(messages.length, 12);
    assert.ok(!messages.at(-1)!.content!.includes('[일지]'));
  });
});
