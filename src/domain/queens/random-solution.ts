import type { QueensSolution } from './types.ts';

function shuffle(columns: number[], random: () => number): number[] {
  for (let index = columns.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const current = columns[index]!;
    columns[index] = columns[swap]!;
    columns[swap] = current;
  }
  return columns;
}

export function createRandomSolution(size: number, random: () => number): QueensSolution {
  const placed: number[] = [];
  const used = new Set<number>();

  function search(row: number): boolean {
    if (row === size) return true;
    const candidates = shuffle(Array.from({ length: size }, (_, column) => column), random);
    for (const column of candidates) {
      if (used.has(column)) continue;
      if (row > 0 && Math.abs(placed[row - 1]! - column) <= 1) continue;
      placed.push(column);
      used.add(column);
      if (search(row + 1)) return true;
      placed.pop();
      used.delete(column);
    }
    return false;
  }

  search(0);
  return placed.map((column, row) => ({ row, column }));
}
