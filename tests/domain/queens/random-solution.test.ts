import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRandomSolution } from '../../../src/domain/queens/random-solution.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

describe('Given a random Queens solution generator', () => {
  it('When generating sizes 5 to 9 Then places one non-touching queen per row and column', () => {
    for (let size = 5; size <= 9; size++) {
      const solution = createRandomSolution(size, seeded(size));
      assert.equal(solution.length, size);
      assert.deepEqual(solution.map(queen => queen.row), Array.from({ length: size }, (_, row) => row));
      assert.equal(new Set(solution.map(queen => queen.column)).size, size);
      for (let row = 1; row < size; row++) assert.ok(Math.abs(solution[row]!.column - solution[row - 1]!.column) > 1);
    }
  });
  it('When the random source differs Then the column order varies between placements', () => {
    const placements = new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(createRandomSolution(8, seeded(seed + 1)))));
    assert.ok(placements.size > 1);
  });
  it('When the random source is the same Then the placement is reproducible', () => {
    assert.deepEqual(createRandomSolution(7, seeded(42)), createRandomSolution(7, seeded(42)));
  });
});
