import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rollDice } from '../../../src/domain/adventure/dice.ts';

describe('Given the adventure difficulty ceiling', () => {
  it('When difficulty exceeds 70 percent of the sides Then reports and applies the capped integer threshold', () => {
    assert.deepEqual(rollDice(20, 20, () => 0.65), { ok: true, value: { sides: 20, difficulty: 14, roll: 14, success: true } });
    assert.deepEqual(rollDice(6, 6, () => 0.5), { ok: true, value: { sides: 6, difficulty: 4, roll: 4, success: true } });
  });
  it('When difficulty is within the ceiling Then keeps normal 8 and hard 12 with the same success boundary', () => {
    for (const difficulty of [8, 12, 14]) {
      const below = rollDice(20, difficulty, () => (difficulty - 2) / 20);
      const at = rollDice(20, difficulty, () => (difficulty - 1) / 20);
      assert.equal(below.ok && below.value.success, false);
      assert.equal(at.ok && at.value.success, true);
      if (at.ok) assert.equal(at.value.difficulty, difficulty);
    }
  });
});
