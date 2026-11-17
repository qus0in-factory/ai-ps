import { validateGrid } from './grid.ts';
import type { QueensSolution, RegionId, SolverResult } from './types.ts';

/**
 * 행마다 퀸을 하나 놓는 백트래킹. 열·영역 점유는 비트마스크로, 인접은 이전 행의 열만 본다.
 * 두 번째 해를 찾는 즉시 탐색을 멈춘다(유일성 판정에 두 개면 충분).
 */
export function solveQueens(input: unknown, { maxNodes = 100_000 }: { maxNodes?: number } = {}): SolverResult {
  const grid = validateGrid(input);
  if (!grid.valid) return { status: 'invalid', solutions: [], nodesVisited: 0 };
  const { size, regions } = grid.puzzle;
  const limit = Number.isSafeInteger(maxNodes) && maxNodes > 0 ? Math.min(maxNodes, 1_000_000) : 0;
  const solutions: QueensSolution[] = [];
  const columns: number[] = [];
  const regionIndex = new Map<RegionId, number>();
  for (const row of regions) for (const region of row) if (!regionIndex.has(region)) regionIndex.set(region, regionIndex.size);
  let columnsMask = 0;
  let regionsMask = 0;
  let nodesVisited = 0;
  let limited = false;
  function search(row: number) {
    if (solutions.length === 2 || limited) return;
    if (row === size) {
      solutions.push(columns.map((column, row) => ({ row, column })));
      return;
    }
    const previous = row > 0 ? columns[row - 1]! : -1;
    for (let column = 0; column < size; column++) {
      if (solutions.length === 2 || limited) return;
      if (nodesVisited >= limit) { limited = true; return; }
      nodesVisited++;
      const bit = 1 << column;
      if (columnsMask & bit) continue;
      const regionBit = 1 << regionIndex.get(regions[row]![column]!)!;
      if (regionsMask & regionBit) continue;
      if (row > 0 && Math.abs(previous - column) <= 1) continue;
      columns.push(column);
      columnsMask |= bit;
      regionsMask |= regionBit;
      search(row + 1);
      columns.pop();
      columnsMask &= ~bit;
      regionsMask &= ~regionBit;
    }
  }
  search(0);
  return {
    status: solutions.length === 2 ? 'multiple' : limited ? 'inconclusive' : solutions.length === 1 ? 'unique' : 'none',
    solutions, nodesVisited,
  };
}
