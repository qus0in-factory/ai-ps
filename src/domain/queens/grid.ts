import { MAX_QUEENS_SIZE, type GridValidation, type QueensIssue, type RegionId } from './types.ts';

export function validateGrid(input: unknown): GridValidation {
  const invalid = (message: string): GridValidation => ({ valid: false, issues: [{ code: 'INVALID_GRID', message }] });
  if (!input || typeof input !== 'object' || !('size' in input) || !('regions' in input)) return invalid('size와 regions 격자가 필요합니다.');
  const { size, regions } = input;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_QUEENS_SIZE) {
    return invalid(`격자 크기 N은 1부터 ${MAX_QUEENS_SIZE}까지의 정수여야 합니다.`);
  }
  if (!Array.isArray(regions) || regions.length !== size || Array.from(regions).some(row => !Array.isArray(row) || row.length !== size)) {
    return invalid('regions는 N개의 행과 각 행마다 N개의 칸을 가진 정사각형이어야 합니다.');
  }
  const groups = new Map<RegionId, number[]>();
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const region: unknown = regions[row][column];
      if (!((typeof region === 'string' && region.trim().length > 0 && region.length <= 64) ||
        (typeof region === 'number' && Number.isSafeInteger(region) && region >= 0))) {
        return invalid('각 칸의 색상 영역 ID는 비어 있지 않은 문자열 또는 0 이상의 정수여야 합니다.');
      }
      const cells = groups.get(region) ?? [];
      cells.push(row * size + column);
      groups.set(region, cells);
    }
  }
  const issues: QueensIssue[] = [];
  if (groups.size !== size) issues.push({ code: 'REGION_COUNT', message: `색상 영역은 정확히 ${size}개여야 합니다. 현재 ${groups.size}개입니다.` });
  for (const [region, cells] of groups) {
    const remaining = new Set(cells);
    const queue = [cells[0]!];
    remaining.delete(queue[0]!);
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head]!;
      const row = Math.floor(cell / size);
      const column = cell % size;
      for (const [dr, dc] of [[-1,0], [1,0], [0,-1], [0,1]]) {
        const nr = row + dr!;
        const nc = column + dc!;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const neighbor = nr * size + nc;
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    if (remaining.size) issues.push({ code: 'DISCONNECTED_REGION', region, message: `색상 영역 ${JSON.stringify(region)}이 상하좌우로 이어져 있지 않습니다.` });
  }
  return issues.length ? { valid: false, issues } : { valid: true, puzzle: { size, regions }, issues: [] };
}
