import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateGrid } from '../../../src/domain/queens/grid.ts';
import { validatePlacement } from '../../../src/domain/queens/placement.ts';

const puzzle = { size: 4, regions: [[0,0,0,0], [0,1,1,1], [2,2,2,2], [3,3,3,3]] };
const solution = [1,3,0,2].map((column, row) => ({ row, column }));

describe('Given a Queens region grid', () => {
  it('When the grid is square and all N regions are connected Then accepts the grid', () => {
    assert.equal(validateGrid(puzzle).valid, true);
    const named = { size: 4, regions: puzzle.regions.map(row => row.map(id => ['red', 'green', 'blue', 'yellow'][id])) };
    assert.equal(validateGrid(named).valid, true);
  });
  it('When the shape, size or region identifier is invalid Then rejects the grid without throwing', () => {
    for (const input of [null, {}, { size: 0, regions: [] }, { size: 2.5, regions: [] },
      { size: 4, regions: [[0]] }, { size: 2, regions: [[0,1], [1]] },
      { size: 2, regions: [[0,null], [1,1]] }, { size: 2, regions: [[0,{}], [1,1]] }]) {
      assert.equal(validateGrid(input).valid, false);
    }
  });
  it('When the number of colors is not N Then reports REGION_COUNT', () => {
    const result = validateGrid({ size: 4, regions: Array.from({ length: 4 }, () => [0,0,0,0]) });
    assert.ok(result.issues.some(issue => issue.code === 'REGION_COUNT'));
  });
  it('When a region is split or connected only diagonally Then reports DISCONNECTED_REGION', () => {
    for (const row of [[0,1,0,0], [0,1,1,1]]) {
      const regions = [row, row[2] === 0 ? [1,1,1,1] : [1,0,1,1], [2,2,2,2], [3,3,3,3]];
      const result = validateGrid({ size: 4, regions });
      assert.ok(result.issues.some(issue => issue.code === 'DISCONNECTED_REGION' && issue.region === 0));
    }
  });
});

describe('Given a complete Queens placement', () => {
  it('When exactly N queens satisfy row, column, region and adjacency rules Then accepts the placement', () => {
    assert.equal(validatePlacement(puzzle, solution).valid, true);
  });
  it('When queens share a distant diagonal Then allows them under LinkedIn Queens rules', () => {
    const board = { size: 5, regions: Array.from({ length: 5 }, (_, row) => Array(5).fill(row)) };
    const queens = [1,3,0,4,2].map((column, row) => ({ row, column }));
    assert.equal(validatePlacement(board, queens).valid, true);
  });
  it('When there are too few queens, duplicates or invalid coordinates Then rejects them', () => {
    for (const queens of [null, solution.slice(1), [solution[0], solution[0], solution[2], solution[3]],
      [{ row: -1, column: 0 }, ...solution.slice(1)], [{ row: 0, column: 4 }, ...solution.slice(1)],
      [{ row: 0.5, column: 0 }, ...solution.slice(1)]]) {
      assert.equal(validatePlacement(puzzle, queens).valid, false);
    }
  });
  it('When two queens share a row, column or region Then reports the corresponding conflict', () => {
    const cases = [
      [solution.map((q, i) => i === 1 ? { ...q, row: 0 } : q), 'ROW_CONFLICT'],
      [solution.map((q, i) => i === 1 ? { ...q, column: 1 } : q), 'COLUMN_CONFLICT'],
      [[2,0,3,1].map((column, row) => ({ row, column })), 'REGION_CONFLICT'],
    ] as const;
    for (const [queens, code] of cases) assert.ok(validatePlacement(puzzle, queens).issues.some(issue => issue.code === code));
  });
  it('When two queens touch diagonally Then reports ADJACENT_QUEENS', () => {
    assert.ok(validatePlacement(puzzle, [0,1,2,3].map((column, row) => ({ row, column }))).issues.some(issue => issue.code === 'ADJACENT_QUEENS'));
  });
});
