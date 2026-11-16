import { createPlayBoard, cycleMark, findConflicts, isSolved, type CellMark } from '../../domain/queens/play.ts';
import type { QueensPuzzle, QueensSolution } from '../../domain/queens/types.ts';

export interface PlayState {
  marks: CellMark[][];
  conflicts: boolean[][];
  solved: boolean;
  revealed: boolean;
  moves: number;
}

export function createPlayController(puzzle: QueensPuzzle, solution: QueensSolution) {
  const listeners = new Set<(state: PlayState) => void>();
  const assess = (marks: CellMark[][], moves: number, revealed: boolean): PlayState => {
    const board = { size: puzzle.size, marks };
    return {
      marks,
      conflicts: findConflicts(puzzle, board),
      solved: revealed || isSolved(puzzle, board),
      revealed,
      moves,
    };
  };
  let state = assess(createPlayBoard(puzzle.size).marks, 0, false);
  const publish = (next: PlayState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
  return {
    getState: () => state,
    subscribe(listener: (state: PlayState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    cycle(row: number, column: number) {
      if (state.solved || state.revealed) return;
      const next = cycleMark({ size: puzzle.size, marks: state.marks }, row, column);
      publish(assess(next.marks, state.moves + 1, false));
    },
    reset() {
      publish(assess(createPlayBoard(puzzle.size).marks, 0, false));
    },
    reveal() {
      const board = createPlayBoard(puzzle.size);
      for (const queen of solution) board.marks[queen.row]![queen.column] = 'queen';
      publish(assess(board.marks, state.moves, true));
    },
  };
}

export type QueensPlayController = ReturnType<typeof createPlayController>;
