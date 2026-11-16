import { validateGrid } from '../../domain/queens/grid.ts';
import { validatePlacement } from '../../domain/queens/placement.ts';
import { solveQueens } from '../../domain/queens/solver.ts';
import type { PuzzleValidation, QueensOperations } from '../../domain/queens/types.ts';

export function validatePuzzle(input: unknown): PuzzleValidation {
  const grid = validateGrid(input);
  if (!grid.valid) return { ...grid, solutionStatus: 'invalid', solutions: [], nodesVisited: 0 };
  const solved = solveQueens(grid.puzzle);
  const issues: PuzzleValidation['issues'] = [];
  if (solved.status === 'none') issues.push({ code: 'NO_SOLUTION', message: '조건을 만족하는 퀸 배치가 없습니다.' });
  if (solved.status === 'multiple') issues.push({
    code: 'MULTIPLE_SOLUTIONS', solutions: solved.solutions,
    message: `정답이 유일하지 않습니다. 서로 다른 두 정답(행·열은 0부터 시작): ${JSON.stringify(solved.solutions[0])} / ${JSON.stringify(solved.solutions[1])}`,
  });
  if (solved.status === 'inconclusive') issues.push({ code: 'SEARCH_LIMIT', message: '탐색 한도에 도달해 정답 존재 여부와 유일성을 확정할 수 없습니다.' });
  return { valid: solved.status === 'unique', issues, solutionStatus: solved.status, solutions: solved.solutions, nodesVisited: solved.nodesVisited };
}

export { validatePlacement };

export function createQueensService(): QueensOperations {
  return { validatePuzzle, validatePlacement };
}
