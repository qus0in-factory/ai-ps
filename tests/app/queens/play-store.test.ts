import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayController, type PlayState } from '../../../src/app/queens/play-store.ts';
import type { QueensPuzzle } from '../../../src/domain/queens/types.ts';

const solution = [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
const puzzle: QueensPuzzle = {
  size: 5,
  regions: [[0, 0, 1, 1, 1], [1, 1, 1, 1, 2], [1, 1, 2, 2, 2], [3, 3, 3, 2, 2], [3, 3, 3, 4, 4]],
};

function placeQueen(controller: ReturnType<typeof createPlayController>, row: number, column: number) {
  controller.cycle(row, column);
  controller.cycle(row, column);
}

describe('Given a Queens play controller', () => {
  it('When a cell is cycled Then marks, moves, and subscribers update', () => {
    const controller = createPlayController(puzzle, solution);
    const seen: PlayState[] = [];
    const unsubscribe = controller.subscribe(state => { seen.push(state); });
    assert.equal(controller.getState().moves, 0);
    assert.equal(controller.getState().marks[0]![0], 'empty');
    controller.cycle(0, 0);
    assert.equal(controller.getState().marks[0]![0], 'cross');
    assert.equal(controller.getState().moves, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.moves, 1);
    unsubscribe();
    controller.cycle(0, 0);
    assert.equal(controller.getState().marks[0]![0], 'queen');
    assert.equal(seen.length, 1);
  });

  it('When two queens share a row Then the controller reports those conflicts', () => {
    const controller = createPlayController(puzzle, solution);
    placeQueen(controller, 0, 0);
    placeQueen(controller, 0, 3);
    assert.equal(controller.getState().conflicts[0]![0], true);
    assert.equal(controller.getState().conflicts[0]![3], true);
    assert.equal(controller.getState().conflicts[1]![1], false);
    assert.equal(controller.getState().solved, false);
  });

  it('When reset Then the board is empty and moves return to zero', () => {
    const controller = createPlayController(puzzle, solution);
    controller.cycle(1, 1);
    controller.reset();
    const state = controller.getState();
    assert.equal(state.moves, 0);
    assert.equal(state.revealed, false);
    assert.equal(state.solved, false);
    assert.ok(state.marks.every(row => row.every(mark => mark === 'empty')));
    assert.ok(state.conflicts.every(row => row.every(conflict => conflict === false)));
  });

  it('When revealed Then the solution is shown and the board is solved', () => {
    const controller = createPlayController(puzzle, solution);
    controller.cycle(1, 1);
    controller.reveal();
    const state = controller.getState();
    assert.equal(state.revealed, true);
    assert.equal(state.solved, true);
    for (const queen of solution) assert.equal(state.marks[queen.row]![queen.column], 'queen');
    assert.equal(state.marks[1]![1], 'empty');
    assert.equal(state.marks.flat().filter(mark => mark === 'queen').length, puzzle.size);
  });

  it('When the board is solved or revealed Then further cycles are ignored', () => {
    const solved = createPlayController(puzzle, solution);
    for (const queen of solution) placeQueen(solved, queen.row, queen.column);
    assert.equal(solved.getState().solved, true);
    const solvedMoves = solved.getState().moves;
    const solvedMarks = solved.getState().marks.map(row => [...row]);
    const afterSolve: number[] = [];
    const stop = solved.subscribe(state => { afterSolve.push(state.moves); });
    solved.cycle(0, 0);
    stop();
    assert.equal(solved.getState().moves, solvedMoves);
    assert.deepEqual(solved.getState().marks, solvedMarks);
    assert.deepEqual(afterSolve, []);

    const revealed = createPlayController(puzzle, solution);
    revealed.reveal();
    const revealedMarks = revealed.getState().marks.map(row => [...row]);
    revealed.cycle(0, 0);
    assert.equal(revealed.getState().moves, 0);
    assert.deepEqual(revealed.getState().marks, revealedMarks);
    assert.equal(revealed.getState().revealed, true);
  });
});
