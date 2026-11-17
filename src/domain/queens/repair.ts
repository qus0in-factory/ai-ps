import { solveQueens } from './solver.ts';
import type { QueensSolution, RegionId, SolverResult } from './types.ts';

/**
 * 퍼즐 영역 보정 도구.
 *
 * 모든 함수는 입력과 solution의 좌표를 바꾸지 않고 새 행렬을 돌려준다.
 * growSmallRegions/breakAlternatives는 퀸 칸의 영역도 유지한다.
 * repairDisconnected의 영역 유지에는 영역마다 퀸이 하나라는 입력 전제가 필요하다.
 */

type Grid = RegionId[][];
type Cell = { row: number; column: number };

const neighbours = (size: number, row: number, column: number): Cell[] => {
  const out: Cell[] = [];
  if (row > 0) out.push({ row: row - 1, column });
  if (row + 1 < size) out.push({ row: row + 1, column });
  if (column > 0) out.push({ row, column: column - 1 });
  if (column + 1 < size) out.push({ row, column: column + 1 });
  return out;
};

const copyGrid = (grid: Grid): Grid => grid.map((row) => [...row]);
const cellKey = (size: number, cell: Cell) => cell.row * size + cell.column;
const queenKeys = (size: number, solution: QueensSolution) => new Set(solution.map((queen) => cellKey(size, queen)));

function counts(grid: Grid): Map<RegionId, number> {
  const map = new Map<RegionId, number>();
  for (const row of grid) for (const region of row) map.set(region, (map.get(region) ?? 0) + 1);
  return map;
}

function regionIds(grid: Grid): RegionId[] {
  return [...counts(grid).keys()];
}

/** 한 영역의 상하좌우 연결 성분들. */
function components(grid: Grid, region: RegionId): Cell[][] {
  const size = grid.length;
  const seen = new Set<number>();
  const out: Cell[][] = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (grid[row]![column] !== region || seen.has(cellKey(size, { row, column }))) continue;
      const component: Cell[] = [];
      const stack = [{ row, column }];
      seen.add(cellKey(size, { row, column }));
      while (stack.length) {
        const cell = stack.pop()!;
        component.push(cell);
        for (const next of neighbours(size, cell.row, cell.column)) {
          if (grid[next.row]![next.column] !== region || seen.has(cellKey(size, next))) continue;
          seen.add(cellKey(size, next));
          stack.push(next);
        }
      }
      out.push(component);
    }
  }
  return out;
}

function isConnected(grid: Grid, region: RegionId): boolean {
  return components(grid, region).length <= 1;
}

function twoCellRegions(grid: Grid): RegionId[] {
  return [...counts(grid)].filter(([, count]) => count === 2).map(([region]) => region);
}

function queenOf(grid: Grid, solution: QueensSolution, region: RegionId): Cell | undefined {
  return solution.find((queen) => grid[queen.row]![queen.column] === region);
}

function takeableCells(grid: Grid, target: RegionId, queens: Set<number>): Cell[] {
  const size = grid.length;
  const cells = new Map<string, Cell>();
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (grid[row]![column] !== target) continue;
      for (const next of neighbours(size, row, column)) {
        const donor = grid[next.row]![next.column]!;
        if (donor === target || queens.has(cellKey(size, next))) continue;
        const key = `${next.row},${next.column}`;
        if (!cells.has(key)) cells.set(key, next);
      }
    }
  }
  const donorCounts = counts(grid);
  return [...cells.values()]
    .filter((cell) => {
      const donor = grid[cell.row]![cell.column]!;
      const donorSize = donorCounts.get(donor) ?? 0;
      if (donorSize - 1 < 3) return false;
      const candidate = copyGrid(grid);
      candidate[cell.row]![cell.column] = target;
      return isConnected(candidate, donor);
    })
    .sort((a, b) => {
      const da = donorCounts.get(grid[a.row]![a.column]!) ?? 0;
      const db = donorCounts.get(grid[b.row]![b.column]!) ?? 0;
      return db - da || cellKey(size, a) - cellKey(size, b);
    });
}

/**
 * 끊어진 영역 조각을 퀸이 있는 연결 성분만 남기고 이웃 영역으로 넘긴다.
 * 넘길 때는 현재 칸 수가 가장 적은 이웃 영역을 고른다(동률은 먼저 만난 순서).
 * 한 영역의 서로 다른 성분에 퀸이 여럿이면 첫 퀸의 성분만 남기므로 다른 퀸 칸의 영역은 바뀔 수 있다.
 */
export function repairDisconnected(regions: Grid, solution: QueensSolution): Grid {
  const size = regions.length;
  const grid = copyGrid(regions);
  const keep = new Set<number>();
  for (const region of regionIds(grid)) {
    const parts = components(grid, region);
    if (!parts.length) continue;
    const queen = queenOf(grid, solution, region);
    const chosen = queen
      ? parts.find((part) => part.some((cell) => cellKey(size, cell) === cellKey(size, queen))) ?? parts[0]!
      : parts.reduce((best, part) => (part.length > best.length ? part : best), parts[0]!);
    for (const cell of chosen) keep.add(cellKey(size, cell));
  }
  const assigned = new Set(keep);
  for (;;) {
    const movable: Cell[] = [];
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        if (assigned.has(cellKey(size, { row, column }))) continue;
        const adjacent = neighbours(size, row, column).filter((next) =>
          assigned.has(cellKey(size, next)) && grid[next.row]![next.column] !== grid[row]![column]);
        if (adjacent.length) movable.push({ row, column });
      }
    }
    if (!movable.length) break;
    const sizes = counts(grid);
    for (const cell of movable) {
      const options = neighbours(size, cell.row, cell.column)
        .filter((next) => assigned.has(cellKey(size, next)) && grid[next.row]![next.column] !== grid[cell.row]![cell.column])
        .map((next) => grid[next.row]![next.column]!);
      if (!options.length) continue;
      const target = options.reduce((best, region) =>
        ((sizes.get(region) ?? 0) < (sizes.get(best) ?? 0) ? region : best), options[0]!);
      grid[cell.row]![cell.column] = target;
      sizes.set(target, (sizes.get(target) ?? 0) + 1);
      assigned.add(cellKey(size, cell));
    }
  }
  return grid;
}

/**
 * 2칸 영역이 2개 이상이면 첫 번째만 남기고, 나머지는 이웃 큰 영역에서 칸 하나를 받아 3칸으로 만든다.
 * 가져가는 쪽은 퀸 칸이 아니고, 연결이 유지되며, 3칸 이상을 유지한다.
 * 기증 가능한 칸이 없으면 미보정 후보를 반환한다. 최종 크기 규칙은 호출자가 검증해야 한다.
 */
export function growSmallRegions(regions: Grid, solution: QueensSolution): Grid {
  const size = regions.length;
  const grid = copyGrid(regions);
  const queens = queenKeys(size, solution);
  const small = twoCellRegions(grid);
  for (const region of small.slice(1)) {
    const [cell] = takeableCells(grid, region, queens);
    if (cell) grid[cell.row]![cell.column] = region;
  }
  return grid;
}

export interface BreakResult {
  regions: Grid;
  status: SolverResult['status'] | 'stuck';
  steps: number;
  solverCalls: number;
}

/**
 * 대체 해가 남아 있으면 그 해의 퀸(정답 퀸이 아닌 칸)을 이웃 영역으로 옮겨 깨뜨린다.
 * 정답의 퀸 칸은 건드리지 않고, 두 영역의 연결과 크기 규칙을 확인한 뒤에만 옮긴다.
 * maxSolverCalls 소진 시에는 변경된 후보가 미확정(inconclusive)임을 반환한다.
 */
export function breakAlternatives(
  regions: Grid,
  solution: QueensSolution,
  { maxSteps = 20, maxSolverCalls = maxSteps + 1 }: { maxSteps?: number; maxSolverCalls?: number } = {},
): BreakResult {
  const size = regions.length;
  const grid = copyGrid(regions);
  let steps = 0, solverCalls = 0;
  const finish = (status: BreakResult['status']): BreakResult => ({ regions: grid, status, steps, solverCalls });
  const solutionKeys = new Set(solution.map((queen) => cellKey(size, queen)));
  const differs = (queen: Cell) => !solutionKeys.has(cellKey(size, queen));
  for (;;) {
    if (solverCalls >= maxSolverCalls) return finish('inconclusive');
    solverCalls++;
    const solved = solveQueens({ size, regions: grid });
    if (solved.status === 'unique') return finish('unique');
    if (solved.status !== 'multiple') return finish(solved.status);
    if (steps >= maxSteps) return finish('multiple');
    const alternative = solved.solutions.find((candidate) => candidate.some(differs))!;
    const movable = alternative.filter(differs);
    let moved = false;
    for (const queen of movable) {
      const from = grid[queen.row]![queen.column]!;
      const regionCounts = counts(grid);
      const options = neighbours(size, queen.row, queen.column)
        .map((next) => grid[next.row]![next.column]!)
        .filter((region) => region !== from)
        .sort((a, b) => (regionCounts.get(b) ?? 0) - (regionCounts.get(a) ?? 0));
      for (const to of options) {
        const candidate = copyGrid(grid);
        candidate[queen.row]![queen.column] = to;
        const sizes = counts(candidate);
        if ((sizes.get(from) ?? 0) < 2) continue;
        if (!isConnected(candidate, from) || !isConnected(candidate, to)) continue;
        if (twoCellRegions(candidate).length > 1) continue;
        grid[queen.row]![queen.column] = to;
        steps++;
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) return finish('stuck');
  }
}

/**
 * LLM 없이 정답 퀸 칸을 씨앗으로 무작위 BFS 확장해 영역을 만든다.
 * 연결된 후보를 만들고 최소 크기·2칸 영역 수를 보정한다. 퀸 칸에는 solution 순서의 영역 ID를 부여한다.
 * 기증 가능한 칸이 없으면 크기 규칙을 만족하지 못할 수 있으므로 최종 validateDesign이 필요하다.
 */
export function growRegionsFromSolution(size: number, solution: QueensSolution, random: () => number): Grid {
  const grid: Grid = Array.from({ length: size }, () => Array.from({ length: size }, () => -1 as RegionId));
  solution.forEach((queen, index) => { grid[queen.row]![queen.column] = index; });
  return fillRegions(grid, solution, random);
}

/** Retain a random connected patch near each queen before filling the remaining cells. */
export function growRegionsFromProposal(proposal: Grid, solution: QueensSolution, random: () => number): { regions: Grid; retainedCells: number } {
  const size = proposal.length;
  const grid: Grid = Array.from({ length: size }, () => Array<RegionId>(size).fill(-1));
  solution.forEach((queen, index) => { grid[queen.row]![queen.column] = index; });
  const sizes = counts(proposal);
  let retainedCells = 0;
  solution.forEach((queen, index) => {
    const label = proposal[queen.row]![queen.column]!;
    const target = Math.max(1, Math.floor(((sizes.get(label) ?? 1) - 1) * (0.1 + random() * 0.5)));
    const frontier: Cell[] = [queen];
    let kept = 0;
    while (frontier.length && kept < target) {
      const pick = Math.floor(random() * frontier.length);
      const from = frontier[pick]!;
      const options = neighbours(size, from.row, from.column).filter(next =>
        grid[next.row]![next.column] === -1 && proposal[next.row]![next.column] === label);
      if (!options.length) { frontier.splice(pick, 1); continue; }
      const next = options[Math.floor(random() * options.length)]!;
      grid[next.row]![next.column] = index;
      frontier.push(next);
      kept++; retainedCells++;
    }
  });
  return { regions: fillRegions(grid, solution, random), retainedCells };
}

function fillRegions(grid: Grid, solution: QueensSolution, random: () => number): Grid {
  const size = grid.length;
  const frontier: Cell[] = solution.map(queen => ({ ...queen }));
  const anchors = queenKeys(size, solution);
  let remaining = 0;
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    if (grid[row]![column] === -1) remaining++;
    else if (!anchors.has(row * size + column)) frontier.push({ row, column });
  }
  while (remaining > 0) {
    if (!frontier.length) break;
    const pick = Math.floor(random() * frontier.length);
    const from = frontier[pick]!;
    const options = neighbours(size, from.row, from.column).filter((next) => grid[next.row]![next.column] === -1);
    if (!options.length) {
      frontier.splice(pick, 1);
      continue;
    }
    const next = options[Math.floor(random() * options.length)]!;
    grid[next.row]![next.column] = grid[from.row]![from.column]!;
    frontier.push(next);
    remaining--;
  }
  // 1칸 영역을 이웃에서 받아 2칸 이상으로 만든 뒤, 2칸 영역이 겹치면 키운다.
  const queens = queenKeys(size, solution);
  const grown = ensureMinSize(grid, queens);
  return growSmallRegions(grown, solution);
}

function ensureMinSize(grid: Grid, queens: Set<number>): Grid {
  const out = copyGrid(grid);
  for (const region of regionIds(out)) {
    if ((counts(out).get(region) ?? 0) >= 2) continue;
    const [cell] = takeableCells(out, region, queens);
    if (cell) out[cell.row]![cell.column] = region;
  }
  return out;
}
