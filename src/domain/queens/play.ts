import { validatePlacement } from './placement.ts';
import type { QueensPuzzle } from './types.ts';

export type CellMark = 'empty' | 'cross' | 'queen';
export interface PlayBoard { size: number; marks: CellMark[][] }

const nextMark: Record<CellMark, CellMark> = { empty: 'cross', cross: 'queen', queen: 'empty' };

export function createPlayBoard(size: number): PlayBoard {
  return { size, marks: Array.from({ length: size }, () => Array.from({ length: size }, () => 'empty' as const)) };
}

export function cycleMark(board: PlayBoard, row: number, column: number): PlayBoard {
  const marks = board.marks.map(cells => [...cells]);
  const current = marks[row]?.[column];
  if (current === undefined) return board;
  marks[row]![column] = nextMark[current];
  return { size: board.size, marks };
}

export function findConflicts(puzzle: QueensPuzzle, board: PlayBoard): boolean[][] {
  const conflicts = Array.from({ length: puzzle.size }, () => Array.from({ length: puzzle.size }, () => false));
  const queens: Array<{ row: number; column: number }> = [];
  for (let row = 0; row < puzzle.size; row++) {
    for (let column = 0; column < puzzle.size; column++) {
      if (board.marks[row]?.[column] === 'queen') queens.push({ row, column });
    }
  }
  for (let left = 0; left < queens.length; left++) {
    for (let right = left + 1; right < queens.length; right++) {
      const a = queens[left]!;
      const b = queens[right]!;
      const sameRow = a.row === b.row;
      const sameColumn = a.column === b.column;
      const sameRegion = puzzle.regions[a.row]![a.column] === puzzle.regions[b.row]![b.column];
      const adjacent = Math.max(Math.abs(a.row - b.row), Math.abs(a.column - b.column)) <= 1;
      if (sameRow || sameColumn || sameRegion || adjacent) {
        conflicts[a.row]![a.column] = true;
        conflicts[b.row]![b.column] = true;
      }
    }
  }
  return conflicts;
}

export function isSolved(puzzle: QueensPuzzle, board: PlayBoard): boolean {
  const queens = [];
  for (let row = 0; row < puzzle.size; row++) {
    for (let column = 0; column < puzzle.size; column++) {
      if (board.marks[row]?.[column] === 'queen') queens.push({ row, column });
    }
  }
  return validatePlacement(puzzle, queens).valid;
}
