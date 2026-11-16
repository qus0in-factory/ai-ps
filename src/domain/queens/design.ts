import { validateGrid } from './grid.ts';
import { validatePlacement } from './placement.ts';
import { solveQueens } from './solver.ts';
import type { PuzzleValidation, QueensIssue, QueensSolution, RegionId } from './types.ts';

function unfinished(issues: QueensIssue[]): PuzzleValidation {
  return { valid: false, issues, solutionStatus: 'invalid', solutions: [], nodesVisited: 0 };
}

function regionsUnderTwoCells(regions: RegionId[][]): QueensIssue[] {
  const counts = new Map<RegionId, number>();
  for (const row of regions) {
    for (const region of row) counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  const issues: QueensIssue[] = [];
  for (const [region, count] of counts) {
    if (count < 2) {
      issues.push({
        code: 'REGION_TOO_SMALL',
        region,
        message: `색상 영역 ${JSON.stringify(region)}은 최소 2칸이어야 합니다. 현재 ${count}칸입니다.`,
      });
    }
  }
  return issues;
}

export function validateDesign(input: unknown, solution: QueensSolution): PuzzleValidation {
  const grid = validateGrid(input);
  if (!grid.valid) return { ...grid, solutionStatus: 'invalid', solutions: [], nodesVisited: 0 };

  const smallRegions = regionsUnderTwoCells(grid.puzzle.regions);
  if (smallRegions.length) return unfinished(smallRegions);

  const placement = validatePlacement(grid.puzzle, solution);
  if (!placement.valid) return unfinished(placement.issues);

  const solved = solveQueens(grid.puzzle);
  const issues: QueensIssue[] = [];
  if (solved.status === 'none') issues.push({ code: 'NO_SOLUTION', message: '조건을 만족하는 퀸 배치가 없습니다.' });
  if (solved.status === 'multiple') issues.push({
    code: 'MULTIPLE_SOLUTIONS',
    solutions: solved.solutions,
    message: `정답이 유일하지 않습니다. 서로 다른 두 정답(행·열은 0부터 시작): ${JSON.stringify(solved.solutions[0])} / ${JSON.stringify(solved.solutions[1])}`,
  });
  if (solved.status === 'inconclusive') {
    issues.push({ code: 'SEARCH_LIMIT', message: '탐색 한도에 도달해 정답 존재 여부와 유일성을 확정할 수 없습니다.' });
  }
  return {
    valid: solved.status === 'unique',
    issues,
    solutionStatus: solved.status,
    solutions: solved.solutions,
    nodesVisited: solved.nodesVisited,
  };
}
