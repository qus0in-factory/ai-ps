import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { solveQueens } from '../../../src/domain/queens/solver.ts';
import { validatePlacement } from '../../../src/domain/queens/placement.ts';

const unique = { size: 4, regions: [[0,0,0,0], [0,1,1,1], [2,2,2,2], [3,3,3,3]] };
const multiple = { size: 4, regions: Array.from({ length: 4 }, (_, row) => Array(4).fill(row)) };
const none = { size: 4, regions: [[0,0,0,0], [0,1,1,0], [2,2,2,2], [3,3,3,3]] };

describe('Given a bounded backtracking Queens solver', () => {
  it('When exactly one solution exists Then returns that solution after exhausting alternatives', () => {
    const result = solveQueens(unique);
    assert.equal(result.status, 'unique');
    assert.deepEqual(result.solutions, [[1,3,0,2].map((column, row) => ({ row, column }))]);
  });
  it('When no solution exists Then reports none', () => {
    assert.equal(solveQueens(none).status, 'none');
    assert.deepEqual(solveQueens(none).solutions, []);
  });
  it('When more than one solution exists Then returns two distinct valid witnesses and stops', () => {
    const result = solveQueens(multiple);
    assert.equal(result.status, 'multiple');
    assert.equal(result.solutions.length, 2);
    assert.notDeepEqual(result.solutions[0], result.solutions[1]);
    for (const solution of result.solutions) assert.equal(validatePlacement(multiple, solution).valid, true);
  });
  it('When the search budget is exhausted Then does not claim non-existence or uniqueness', () => {
    const result = solveQueens(unique, { maxNodes: 1 });
    assert.equal(result.status, 'inconclusive');
    assert.ok(result.nodesVisited <= 1);
  });
  it('When one witness is found but alternatives remain unsearched Then reports inconclusive', () => {
    const completed = solveQueens(unique);
    const result = solveQueens(unique, { maxNodes: completed.nodesVisited - 1 });
    assert.equal(result.solutions.length, 1);
    assert.equal(result.status, 'inconclusive');
  });
  it('When the board is invalid Then rejects it before searching', () => {
    assert.equal(solveQueens({ size: 2, regions: [] }).status, 'invalid');
    assert.equal(solveQueens({ size: 2, regions: [] }).nodesVisited, 0);
  });
  it('When solving the 1×1 base case Then finds the single queen', () => {
    assert.deepEqual(solveQueens({ size: 1, regions: [[0]] }).solutions, [[{ row: 0, column: 0 }]]);
  });
});
