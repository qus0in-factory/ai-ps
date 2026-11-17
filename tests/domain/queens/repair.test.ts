import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { breakAlternatives, growRegionsFromProposal, growRegionsFromSolution, growSmallRegions, repairDisconnected } from '../../../src/domain/queens/repair.ts';
import { validateGrid } from '../../../src/domain/queens/grid.ts';
import { solveQueens } from '../../../src/domain/queens/solver.ts';
import { createRandomSolution } from '../../../src/domain/queens/random-solution.ts';
import type { QueensSolution, RegionId } from '../../../src/domain/queens/types.ts';

const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const counts = (grid: RegionId[][]) => {
  const map = new Map<RegionId, number>();
  for (const row of grid) for (const region of row) map.set(region, (map.get(region) ?? 0) + 1);
  return map;
};
const sizes = (grid: RegionId[][]) => [...counts(grid).values()];
const twoCellCount = (grid: RegionId[][]) => sizes(grid).filter((count) => count === 2).length;
const queensKept = (grid: RegionId[][], solution: QueensSolution) =>
  solution.every((queen, index) => grid[queen.row]![queen.column] === index);
const validGrid = (grid: RegionId[][]) => validateGrid({ size: grid.length, regions: grid }).valid;

describe('Given a model layout used as a partial seed', () => {
  const fixed = [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
  const horizontal = Array.from({ length: 5 }, (_, row) => Array(5).fill(row));
  const vertical = Array.from({ length: 5 }, () => [0, 1, 2, 3, 4]);
  it('When regrown Then retains nonqueen model cells, preserves anchors, and does not mutate the proposal', () => {
    const before = structuredClone(horizontal);
    const result = growRegionsFromProposal(horizontal, fixed, seeded(42));
    assert.ok(result.retainedCells > 0);
    assert.equal(validGrid(result.regions), true);
    assert.equal(queensKept(result.regions, fixed), true);
    assert.deepEqual(horizontal, before);
  });
  it('When the model layout changes with the same random stream Then the grown layout changes', () => {
    const first = growRegionsFromProposal(horizontal, fixed, seeded(42));
    const second = growRegionsFromProposal(vertical, fixed, seeded(42));
    assert.ok(first.retainedCells > 0 && second.retainedCells > 0);
    assert.notDeepEqual(first.regions, second.regions);
  });
  it('When no same-region neighbour exists Then reports zero retained cells instead of claiming model influence', () => {
    const isolated = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => (row + column) % 2));
    const result = growRegionsFromProposal(isolated, fixed, seeded(42));
    assert.equal(result.retainedCells, 0);
    assert.equal(validGrid(result.regions), true);
  });
});

describe('Given a region split into detached pieces', () => {
  const disconnected = [[0, 1, 1, 1], [1, 1, 2, 2], [0, 1, 2, 2], [3, 3, 3, 3]];
  const solution: QueensSolution = [
    { row: 0, column: 0 }, { row: 1, column: 1 }, { row: 2, column: 2 }, { row: 3, column: 0 },
  ];
  it('When repaired Then every region is connected and the answer cells keep their region', () => {
    const grid = repairDisconnected(disconnected, solution);
    assert.equal(validGrid(grid), true);
    assert.equal(queensKept(grid, solution), true);
    assert.deepEqual([...counts(grid).keys()].sort(), [0, 1, 2, 3]);
    assert.equal(grid[0]![0], 0, '퀸 칸의 영역은 바뀌지 않는다');
  });
  it('When a detached piece is moved Then it joins the smallest adjacent region', () => {
    const grid = repairDisconnected(disconnected, solution);
    // (2,0)은 0에서 떨어져 나온 조각: 이웃 1(6칸)·3(4칸) 중 작은 3으로 간다.
    assert.equal(grid[2]![0], 3);
  });
  it('When the input is already connected Then it is returned unchanged', () => {
    const connected = [[0, 1, 1, 1], [0, 0, 2, 2], [3, 3, 2, 2], [3, 3, 3, 3]];
    assert.deepEqual(repairDisconnected(connected, solution), connected);
  });
});

describe('Given a design with two 2-cell regions', () => {
  it('When repairing the review seed 910*101+5 Then never shrinks a 3-cell donor into another 2-cell region', () => {
    const fixed = createRandomSolution(5, seeded(910 * 101 + 5));
    assert.deepEqual(fixed.map(queen => queen.column), [1, 3, 0, 2, 4]);
    const grid = [[0,0,1,1,1], [1,1,1,1,1], [2,2,3,1,1], [1,2,3,1,4], [1,1,1,1,4]];
    const before = counts(grid);
    const grown = growSmallRegions(grid, fixed);
    const after = counts(grown);
    for (const [region, size] of before) if (size >= 3) assert.ok(after.get(region)! >= 3);
    assert.equal(after.get(2), 3);
    assert.equal(validGrid(grown), true);
    assert.deepEqual(fixed.map(queen => grown[queen.row]![queen.column]), fixed.map(queen => grid[queen.row]![queen.column]));
    assert.deepEqual(counts(grid), before, '입력을 변경하지 않는다');
  });
  const small = [[0, 1, 1, 1], [0, 1, 1, 2], [3, 3, 3, 2], [3, 3, 3, 3]];
  const solution: QueensSolution = [
    { row: 0, column: 0 }, { row: 1, column: 1 }, { row: 2, column: 3 }, { row: 3, column: 0 },
  ];
  it('When grown Then only one 2-cell region remains and every region keeps at least two cells', () => {
    const grid = growSmallRegions(small, solution);
    assert.equal(twoCellCount(grid), 1);
    assert.equal(Math.min(...sizes(grid)), 2);
    assert.equal(validGrid(grid), true);
    assert.equal(queensKept(grid, solution), true);
  });
  it('When a region grew Then it took a cell from a larger neighbour', () => {
    const grid = growSmallRegions(small, solution);
    assert.equal(counts(grid).get(2), 3);
  });
  it('When only one 2-cell region exists Then nothing changes', () => {
    const one = [[0, 1, 1, 1], [0, 1, 1, 1], [3, 3, 3, 2], [3, 3, 3, 3]];
    const before = JSON.stringify(one);
    growSmallRegions(one, solution);
    assert.equal(JSON.stringify(one), before, '입력을 바꾸지 않는다');
  });
});

describe('Given a puzzle with more than one answer', () => {
  const regions = [[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]];
  const solution: QueensSolution = [
    { row: 0, column: 1 }, { row: 1, column: 3 }, { row: 2, column: 0 }, { row: 3, column: 2 },
  ];
  for (const maxSolverCalls of [0, 1, 2]) {
    it(`When the solver budget is ${maxSolverCalls} Then never exceeds that many solver invocations`, () => {
      const result = breakAlternatives(regions, solution, { maxSteps: 20, maxSolverCalls });
      assert.equal(result.solverCalls, maxSolverCalls);
      assert.ok(result.steps <= maxSolverCalls);
      if (maxSolverCalls === 0) {
        assert.equal(result.status, 'inconclusive');
        assert.deepEqual(result.regions, regions);
      }
    });
  }
  it('When alternatives are broken Then the puzzle becomes unique and keeps the given answer', () => {
    const result = breakAlternatives(regions, solution);
    assert.equal(result.status, 'unique');
    assert.ok(result.steps >= 1 && result.steps <= 20);
    assert.equal(validGrid(result.regions), true);
    assert.equal(queensKept(result.regions, solution), true);
    const solved = solveQueens({ size: 4, regions: result.regions });
    assert.deepEqual(solved.solutions[0], solution);
  });
  it('When the step budget is zero Then it stops without changing the regions', () => {
    const result = breakAlternatives(regions, solution, { maxSteps: 0 });
    assert.equal(result.status, 'multiple');
    assert.equal(result.steps, 0);
    assert.deepEqual(result.regions, regions);
  });
  it('When the puzzle is already unique Then it returns without moves', () => {
    const unique = [[0, 0, 1, 1], [2, 2, 1, 1], [2, 2, 3, 3], [2, 3, 3, 3]];
    const fixed: QueensSolution = [
      { row: 0, column: 1 }, { row: 1, column: 3 }, { row: 2, column: 0 }, { row: 3, column: 2 },
    ];
    const result = breakAlternatives(unique, fixed);
    assert.equal(result.steps, 0);
    assert.deepEqual(result.regions, unique);
  });
});

describe('Given only a queen placement', () => {
  it('When regions are grown from it Then the layout is connected, sizes are legal and queens stay put', () => {
    const random = seeded(7);
    for (const size of [5, 6, 7, 8, 9]) {
      const solution = createRandomSolution(size, random);
      const grid = growRegionsFromSolution(size, solution, random);
      assert.equal(grid.length, size);
      assert.equal(validGrid(grid), true, `${size}×${size} 연결`);
      assert.equal(Math.min(...sizes(grid)) >= 2, true, `${size}×${size} 최소 2칸`);
      assert.ok(twoCellCount(grid) <= 1, `${size}×${size} 2칸 영역 1개 이하`);
      assert.equal(queensKept(grid, solution), true, `${size}×${size} 정답 칸 유지`);
    }
  });
  it('When the same seed is used Then the layout is reproducible', () => {
    const solution = createRandomSolution(6, seeded(11));
    const first = growRegionsFromSolution(6, solution, seeded(21));
    const second = growRegionsFromSolution(6, solution, seeded(21));
    assert.deepEqual(first, second);
  });
});
