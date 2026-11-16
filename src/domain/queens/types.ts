export const MAX_QUEENS_SIZE = 12;
export type RegionId = string | number;
export interface QueensPuzzle { size: number; regions: RegionId[][] }
export interface QueenPosition { row: number; column: number }
export type QueensSolution = QueenPosition[];
export type QueensIssueCode = 'INVALID_GRID' | 'REGION_COUNT' | 'DISCONNECTED_REGION' |
  'QUEEN_COUNT' | 'INVALID_POSITION' | 'DUPLICATE_CELL' | 'ROW_CONFLICT' | 'COLUMN_CONFLICT' |
  'REGION_CONFLICT' | 'ADJACENT_QUEENS' | 'NO_SOLUTION' | 'MULTIPLE_SOLUTIONS' | 'SEARCH_LIMIT';
export interface QueensIssue {
  code: QueensIssueCode;
  message: string;
  region?: RegionId;
  solutions?: QueensSolution[];
}
export interface QueensValidation { valid: boolean; issues: QueensIssue[] }
export type GridValidation =
  | { valid: true; puzzle: QueensPuzzle; issues: [] }
  | { valid: false; issues: QueensIssue[] };
export type SolutionStatus = 'invalid' | 'none' | 'unique' | 'multiple' | 'inconclusive';
export interface SolverResult {
  status: SolutionStatus;
  solutions: QueensSolution[];
  nodesVisited: number;
}
export interface PuzzleValidation extends QueensValidation {
  solutionStatus: SolutionStatus;
  solutions: QueensSolution[];
  nodesVisited: number;
}
export interface GeneratedPuzzle { puzzle: QueensPuzzle; solution: QueensSolution; attempts: number }
export interface QueensOperations {
  validatePuzzle(input: unknown): PuzzleValidation;
  validatePlacement(input: unknown, queens: unknown): QueensValidation;
}
