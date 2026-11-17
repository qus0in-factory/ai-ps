import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { breakAlternatives, growRegionsFromSolution } from '../../../src/domain/queens/repair.ts';
import { validateGrid } from '../../../src/domain/queens/grid.ts';
import { solveQueens } from '../../../src/domain/queens/solver.ts';
import { validatePlacement } from '../../../src/domain/queens/placement.ts';
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

const sizeOf = (grid: RegionId[][], region: RegionId) =>
  grid.reduce((sum, row) => sum + row.filter((cell) => cell === region).length, 0);
const sizes = (grid: RegionId[][]) => [...new Set(grid.flat())].map((region) => sizeOf(grid, region));
const queensKept = (grid: RegionId[][], solution: QueensSolution) =>
  solution.every((queen, index) => grid[queen.row]![queen.column] === index);
const twoCellCount = (grid: RegionId[][]) => sizes(grid).filter((size) => size === 2).length;

describe('Given many random queen placements (property test)', () => {
  it('When regions are grown and alternatives are broken Then the invariants hold', () => {
    let checked = 0;
    let unique = 0;
    let stuck = 0;
    let growMs = 0;
    let breakMs = 0;
    const start = performance.now();
    for (const size of [5, 6, 7, 8, 9]) {
      for (let seed = 1; seed <= 10; seed++) {
        const random = seeded(seed * 101 + size);
        const solution = createRandomSolution(size, random);
        assert.equal(solution.length, size, `${size}×${size} seed ${seed}: 정답 생성`);

        const growStart = performance.now();
        const grid = growRegionsFromSolution(size, solution, random);
        growMs += performance.now() - growStart;

        assert.equal(validateGrid({ size, regions: grid }).valid, true, `${size}×${size} seed ${seed}: 연결`);
        assert.equal(queensKept(grid, solution), true, `${size}×${size} seed ${seed}: 정답 칸 유지`);
        assert.ok(Math.min(...sizes(grid)) >= 2, `${size}×${size} seed ${seed}: 최소 2칸`);
        assert.ok(twoCellCount(grid) <= 1, `${size}×${size} seed ${seed}: 2칸 영역 1개 이하`);

        const breakStart = performance.now();
        const result = breakAlternatives(grid, solution);
        breakMs += performance.now() - breakStart;
        assert.equal(validateGrid({ size, regions: result.regions }).valid, true, `${size}×${size} seed ${seed}: 보정 뒤 연결`);
        const solved = solveQueens({ size, regions: result.regions });
        if (result.status === 'unique') {
          unique++;
          assert.deepEqual(solved.solutions[0], solution, `${size}×${size} seed ${seed}: 정답 유지`);
        } else {
          if (result.status === 'stuck') stuck++;
          assert.equal(validatePlacement({ size, regions: result.regions }, solution).valid, true,
            `${size}×${size} seed ${seed}: 정답 배치는 여전히 유효`);
        }
        checked++;
      }
    }
    const totalMs = performance.now() - start;
    console.log(JSON.stringify({
      checked, unique, stuck,
      uniqueRate: Number((unique / checked).toFixed(3)),
      avgGrowMs: Number((growMs / checked).toFixed(3)),
      avgBreakMs: Number((breakMs / checked).toFixed(3)),
      totalMs: Number(totalMs.toFixed(1)),
    }));
    assert.ok(checked >= 50);
    assert.ok(unique > 0, '보정으로 유일해에 도달하는 경우가 있어야 한다');
  });
});
