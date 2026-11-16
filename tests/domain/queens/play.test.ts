import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayBoard, cycleMark, findConflicts, isSolved, type PlayBoard } from '../../../src/domain/queens/play.ts';
import type { QueensPuzzle } from '../../../src/domain/queens/types.ts';

const solution = [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
const puzzle: QueensPuzzle = {
  size: 5,
  regions: [[0, 0, 1, 1, 1], [1, 1, 1, 1, 2], [1, 1, 2, 2, 2], [3, 3, 3, 2, 2], [3, 3, 3, 4, 4]],
};

function withQueens(cells: ReadonlyArray<readonly [number, number]>): PlayBoard {
  return cells.reduce((board, [row, column]) => cycleMark(cycleMark(board, row, column), row, column), createPlayBoard(puzzle.size));
}

function conflictCells(conflicts: boolean[][]): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  conflicts.forEach((row, rowIndex) => row.forEach((conflict, column) => {
    if (conflict) cells.push([rowIndex, column]);
  }));
  return cells;
}

describe('Given a Queens play board', () => {
  it('When a cell is cycled Then the mark goes empty, cross, queen, then empty', () => {
    const empty = createPlayBoard(3);
    assert.deepEqual(empty.marks, [
      ['empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty'],
      ['empty', 'empty', 'empty'],
    ]);
    const cross = cycleMark(empty, 1, 2);
    const queen = cycleMark(cross, 1, 2);
    const again = cycleMark(queen, 1, 2);
    assert.equal(cross.marks[1]![2], 'cross');
    assert.equal(queen.marks[1]![2], 'queen');
    assert.equal(again.marks[1]![2], 'empty');
  });

  it('When a cell is cycled Then the previous board stays unchanged', () => {
    const board = createPlayBoard(3);
    const row = board.marks[0]!;
    const next = cycleMark(board, 0, 1);
    assert.notEqual(next, board);
    assert.notEqual(next.marks, board.marks);
    assert.notEqual(next.marks[0], row);
    assert.equal(row[1], 'empty');
    assert.equal(next.marks[0]![1], 'cross');
    assert.equal(next.marks[2]![2], 'empty');
  });
});

describe('Given queens placed on the unique region grid', () => {
  it('When two queens share a row Then only those cells conflict', () => {
    assert.deepEqual(conflictCells(findConflicts(puzzle, withQueens([[0, 0], [0, 3]]))), [[0, 0], [0, 3]]);
  });

  it('When two queens share a column Then only those cells conflict', () => {
    assert.deepEqual(conflictCells(findConflicts(puzzle, withQueens([[0, 4], [3, 4]]))), [[0, 4], [3, 4]]);
  });

  it('When two queens share a region Then only those cells conflict', () => {
    assert.deepEqual(conflictCells(findConflicts(puzzle, withQueens([[0, 2], [2, 0]]))), [[0, 2], [2, 0]]);
  });

  it('When two queens touch diagonally Then only those cells conflict', () => {
    assert.deepEqual(conflictCells(findConflicts(puzzle, withQueens([[0, 0], [1, 1]]))), [[0, 0], [1, 1]]);
  });

  it('When two queens lie on a distant diagonal Then neither cell conflicts', () => {
    assert.deepEqual(conflictCells(findConflicts(puzzle, withQueens([[0, 0], [2, 2]]))), []);
  });

  it('When fewer than N queens are placed Then the board is not solved', () => {
    assert.equal(isSolved(puzzle, withQueens([[0, 0], [1, 2], [2, 4], [3, 1]])), false);
  });

  it('When the queens conflict Then the board is not solved', () => {
    assert.equal(isSolved(puzzle, withQueens([[0, 0], [0, 3], [1, 2], [2, 4], [4, 1]])), false);
  });

  it('When the given solution is placed Then the board is solved', () => {
    assert.equal(isSolved(puzzle, withQueens(solution.map(queen => [queen.row, queen.column]))), true);
  });
});
