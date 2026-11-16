import { validateGrid } from './grid.ts';
import type { QueenPosition, QueensIssue, QueensValidation, RegionId } from './types.ts';

export function validatePlacement(input: unknown, queens: unknown): QueensValidation {
  const grid = validateGrid(input);
  if (!grid.valid) return grid;
  const { size, regions } = grid.puzzle;
  if (!Array.isArray(queens) || queens.length !== size) {
    return { valid: false, issues: [{ code: 'QUEEN_COUNT', message: `퀸은 정확히 ${size}개여야 합니다.` }] };
  }
  const issues: QueensIssue[] = [];
  const positions: QueenPosition[] = [];
  const cells = new Set<string>();
  const rows = new Set<number>();
  const columns = new Set<number>();
  const colors = new Set<RegionId>();
  for (const queen of queens) {
    if (!queen || typeof queen !== 'object' || !Number.isInteger(queen.row) || !Number.isInteger(queen.column) ||
      queen.row < 0 || queen.row >= size || queen.column < 0 || queen.column >= size) {
      issues.push({ code: 'INVALID_POSITION', message: `퀸 좌표 row와 column은 0부터 ${size - 1}까지의 정수여야 합니다.` });
      continue;
    }
    const { row, column } = queen;
    const cell = `${row},${column}`;
    const color = regions[row]![column]!;
    if (cells.has(cell)) issues.push({ code: 'DUPLICATE_CELL', message: `(${row},${column}) 칸에 퀸이 중복 배치되었습니다.` });
    if (rows.has(row)) issues.push({ code: 'ROW_CONFLICT', message: `${row}행에 퀸이 여러 개 있습니다.` });
    if (columns.has(column)) issues.push({ code: 'COLUMN_CONFLICT', message: `${column}열에 퀸이 여러 개 있습니다.` });
    if (colors.has(color)) issues.push({ code: 'REGION_CONFLICT', region: color, message: `영역 ${JSON.stringify(color)}에 퀸이 여러 개 있습니다.` });
    if (positions.some(other => Math.max(Math.abs(other.row - row), Math.abs(other.column - column)) <= 1)) {
      issues.push({ code: 'ADJACENT_QUEENS', message: `(${row},${column})의 퀸이 다른 퀸과 대각선을 포함해 인접합니다.` });
    }
    cells.add(cell); rows.add(row); columns.add(column); colors.add(color);
    positions.push({ row, column });
  }
  return { valid: issues.length === 0, issues };
}
