import type { Tool } from '../domain/tools.ts';
import { MAX_QUEENS_SIZE, type QueensOperations } from '../domain/queens/types.ts';

const puzzleProperties = {
  size: { type: 'integer', minimum: 1, maximum: MAX_QUEENS_SIZE },
  regions: { type: 'array', minItems: 1, maxItems: MAX_QUEENS_SIZE, items: {
    type: 'array', minItems: 1, maxItems: MAX_QUEENS_SIZE,
    items: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', minLength: 1, maxLength: 64 }] },
  } },
};

export function createQueensTools(queens: QueensOperations): Tool[] {
  return [{
    definition: {
      name: 'verify_puzzle',
      description: 'Validate a LinkedIn Queens puzzle: N×N grid, exactly N orthogonally connected color regions, and exactly one solution using bounded backtracking. One queen per row, column and region; no touching, including diagonals. If non-unique, returns two distinct solutions in the error message. Coordinates start at 0. Never claim uniqueness without this tool.',
      parameters: { type: 'object', properties: puzzleProperties, required: ['size', 'regions'], additionalProperties: false },
    },
    effect: 'read',
    async execute(args) { return { ok: true, value: queens.validatePuzzle(args) }; },
  }, {
    definition: {
      name: 'validate_queens_placement',
      description: 'Validate a complete placement of N queens under LinkedIn Queens rules. Coordinates row and column start at 0; distant diagonals are allowed.',
      parameters: { type: 'object', properties: { ...puzzleProperties, queens: {
        type: 'array', minItems: 1, maxItems: MAX_QUEENS_SIZE, items: { type: 'object', properties: {
          row: { type: 'integer', minimum: 0, maximum: MAX_QUEENS_SIZE - 1 },
          column: { type: 'integer', minimum: 0, maximum: MAX_QUEENS_SIZE - 1 },
        }, required: ['row', 'column'], additionalProperties: false },
      } }, required: ['size', 'regions', 'queens'], additionalProperties: false },
    },
    effect: 'read',
    async execute(args) {
      const positions = args && typeof args === 'object' && 'queens' in args ? args.queens : undefined;
      return { ok: true, value: queens.validatePlacement(args, positions) };
    },
  }];
}
