import { validateGrid } from './grid.ts';
import type { QueensSolution, RegionId, SolverResult } from './types.ts';

export function solveQueens(input: unknown, { maxNodes = 100_000 }: { maxNodes?: number } = {}): SolverResult {
  const grid = validateGrid(input);
  if (!grid.valid) return { status: 'invalid', solutions: [], nodesVisited: 0 };
  const { size, regions } = grid.puzzle;
  const limit = Number.isSafeInteger(maxNodes) && maxNodes > 0 ? Math.min(maxNodes, 1_000_000) : 0;
  const solutions: QueensSolution[] = [];
  const columns: number[] = [];
  const usedColumns = new Set<number>();
  const usedRegions = new Set<RegionId>();
  let nodesVisited = 0;
  let limited = false;
  function search(row: number) {
    if (solutions.length === 2 || limited) return;
    if (row === size) {
      solutions.push(columns.map((column, row) => ({ row, column })));
      return;
    }
    for (let column = 0; column < size; column++) {
      if (solutions.length === 2 || limited) return;
      if (nodesVisited >= limit) { limited = true; return; }
      nodesVisited++;
      const region = regions[row]![column]!;
      if (usedColumns.has(column) || usedRegions.has(region) || (row > 0 && Math.abs(columns[row - 1]! - column) <= 1)) continue;
      columns.push(column); usedColumns.add(column); usedRegions.add(region);
      search(row + 1);
      columns.pop(); usedColumns.delete(column); usedRegions.delete(region);
    }
  }
  search(0);
  return {
    status: solutions.length === 2 ? 'multiple' : limited ? 'inconclusive' : solutions.length === 1 ? 'unique' : 'none',
    solutions, nodesVisited,
  };
}
