import type { ChatMessage } from '../../domain/chat.ts';
import type { CompletionGateway } from '../../domain/completion.ts';
import { validateDesign } from '../../domain/queens/design.ts';
import { MAX_QUEENS_RETRIES, type GenerationListener, type QueensGenerator } from '../../domain/queens/generation.ts';
import { createRandomSolution } from '../../domain/queens/random-solution.ts';
import { validateGrid } from '../../domain/queens/grid.ts';
import { breakAlternatives, growRegionsFromSolution, growSmallRegions, repairDisconnected } from '../../domain/queens/repair.ts';
import type { PuzzleValidation, QueensSolution, RegionId } from '../../domain/queens/types.ts';

interface GeneratorOptions {
  place?: (size: number) => QueensSolution;
  log?: GenerationListener;
  now?: () => number;
  random?: () => number;
}

const CALL_TIMEOUT_MS = 180_000;
// Leave time to deliver the final event before the browser's 300 s deadline.
const GENERATION_TIMEOUT_MS = 290_000;
const FALLBACK_RESERVE_MS = 500;
const MAX_FALLBACK_RESTARTS = 500;
const MAX_FALLBACK_SOLVER_CALLS = 1000;
const TIMEOUT_REASON = '퍼즐 생성 제한 시간(290초)을 초과했습니다. 재시도를 중단합니다.';

function invalid(message: string): PuzzleValidation {
  return { valid: false, solutionStatus: 'invalid', solutions: [], nodesVisited: 0,
    issues: [{ code: 'INVALID_GRID', message }] };
}

function systemPrompt(size: number): string {
  return [
    'You are a color region designer for LinkedIn Queens puzzles.',
    `You receive a fixed queen placement on a ${size}×${size} grid.`,
    'Do not move, add or remove the given queens. Your job is only to color the grid so that the given placement is the ONLY solution.',
    '',
    'Region rules:',
    `- The grid is exactly ${size}×${size}.`,
    `- Use exactly ${size} regions with integer IDs 0..${size - 1}.`,
    `- Every cell belongs to exactly one region.`,
    '- Each region is connected through shared up/down/left/right edges, not only diagonally.',
    '- Each region contains exactly one of the given queens.',
    '- Each region must have at least 2 cells.',
    '- At most one region may have exactly 2 cells; every other region must have at least 3 cells.',
    '',
    'Queens rules the finished puzzle must follow:',
    '- Exactly one queen in each row, each column and each region.',
    '- Queens cannot touch, even diagonally. Distant diagonals are allowed.',
    '',
    'How to force uniqueness:',
    '- Shape region borders so that every other one-per-row, one-per-column placement would put two queens in one region or leave a region without a queen.',
    '- Block the cells where an alternative queen could otherwise sit while keeping each region connected and at least 2 cells.',
    '- Before answering, mentally check that no second non-touching placement satisfies all constraints.',
    '',
    `Output only JSON: {"regions": [[...]]} with ${size} arrays of ${size} integer region IDs, top row first.`,
    'No explanation, no markdown fences, no extra keys.',
  ].join('\n');
}

function userPrompt(size: number, solution: QueensSolution): string {
  const queens = solution.map(queen => `(${queen.row},${queen.column})`).join(', ');
  const grid = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) =>
    solution.some(queen => queen.row === row && queen.column === column) ? 'Q' : '.').join(' ')).join('\n');
  return [
    `Design the ${size} color regions for this ${size}×${size} Queens grid.`,
    `Queens (row,column) in row order: ${queens}`,
    'Grid (Q = given queen, . = empty):',
    grid,
  ].join('\n');
}

export function createQueensGenerator(model: CompletionGateway, options: GeneratorOptions = {}): QueensGenerator {
  const random = options.random ?? Math.random;
  const place = options.place ?? ((size: number) => createRandomSolution(size, random));
  const now = options.now ?? (() => performance.now());
  return {
    async generate(size, onEvent, signal) {
      if (!Number.isInteger(size) || size < 5 || size > 9) return { ok: false, reason: '격자 크기는 5부터 9까지의 정수여야 합니다.' };
      if (signal?.aborted) return { ok: false, reason: '퍼즐 생성을 중단했습니다.' };
      const deadline = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const expiresAt = now() + GENERATION_TIMEOUT_MS;
      const expired = () => deadline.aborted || now() >= expiresAt;
      const emit: GenerationListener = (event) => { options.log?.(event); onEvent?.(event); };
      const stop = (reason: string, attempt: number) => {
        emit({ kind: 'stopped', attempt, reason });
        return { ok: false as const, reason };
      };
      const interrupted = (attempt: number) => {
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.', attempt);
        if (expired()) return stop(TIMEOUT_REASON, attempt);
      };

      const solution = place(size);
      const complete = (regions: RegionId[][], attempt: number) => {
        emit({ kind: 'complete', attempt });
        return { ok: true as const, value: { puzzle: { size, regions }, solution, attempts: attempt } };
      };
      emit({ kind: 'placement', attempt: 1, solution });

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt(size) },
        { role: 'user', content: userPrompt(size, solution) },
      ];
      for (let attempt = 1; attempt <= MAX_QUEENS_RETRIES + 1; attempt++) {
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.', attempt);
        const remainingMs = Math.ceil(expiresAt - now());
        if (deadline.aborted || remainingMs <= 0) return stop(TIMEOUT_REASON, attempt);
        emit({ kind: 'attempt', attempt, retry: attempt - 1 });
        const response = await model.complete(messages, {
          response_format: { type: 'json_object' }, signal: requestSignal,
          timeoutMs: Math.min(CALL_TIMEOUT_MS, Math.max(1, remainingMs - FALLBACK_RESERVE_MS)),
        });
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.', attempt);
        if (expired()) return stop(TIMEOUT_REASON, attempt);
        if (!response.ok) {
          if (attempt <= MAX_QUEENS_RETRIES) emit({ kind: 'feedback', attempt, message: `모델 응답을 받지 못해 한 번 재시도합니다. ${response.reason}` });
          continue;
        }

        const content = response.value.content ?? '';
        let regions: unknown = null;
        let parsed = true;
        try {
          const data: unknown = JSON.parse(content);
          if (data && typeof data === 'object' && 'regions' in data) regions = (data as { regions: unknown }).regions;
          else parsed = false;
        } catch { parsed = false; }
        emit({ kind: 'candidate', attempt, regions });

        // Only well-shaped grids reach repair; disconnected regions are repairable.
        const grid = validateGrid({ size, regions });
        if (grid.valid || grid.issues.every(issue => issue.code === 'DISCONNECTED_REGION')) {
          const connected = repairDisconnected(regions as RegionId[][], solution);
          const grown = growSmallRegions(connected, solution);
          const changes = [];
          if (JSON.stringify(connected) !== JSON.stringify(regions)) changes.push('끊긴 영역 연결');
          if (JSON.stringify(grown) !== JSON.stringify(connected)) changes.push('작은 영역 확장');
          regions = grown;
          if (changes.length) emit({ kind: 'repair', attempt, message: `코드 보정: ${changes.join(' · ')}` });
        }
        let report = parsed
          ? validateDesign({ size, regions: regions as RegionId[][] }, solution)
          : invalid('응답이 {"regions": [...]} 형태의 JSON이 아닙니다. 크기에 맞는 영역 행렬만 출력하세요.');
        emit({ kind: 'validation', attempt, report });
        let halted = interrupted(attempt);
        if (halted) return halted;

        if (report.solutionStatus === 'multiple') {
          const broken = breakAlternatives(regions as RegionId[][], solution, { maxSteps: 20 });
          regions = broken.regions;
          emit({ kind: 'repair', attempt, message: `코드 보정: 대체 해 제거 · 이동 ${broken.steps}회` });
          report = validateDesign({ size, regions: broken.regions }, solution);
          emit({ kind: 'validation', attempt, report });
        }
        halted = interrupted(attempt);
        if (halted) return halted;

        if (report.valid && report.solutionStatus === 'unique') {
          return complete(regions as RegionId[][], attempt);
        }

        if (attempt <= MAX_QUEENS_RETRIES) {
          const feedback = report.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n') ||
            'UNKNOWN: 검증 결과를 확인하지 못했습니다.';
          messages.push({ role: 'assistant', content });
          messages.push({ role: 'user', content: `The region design failed validation. Current regions after code repair: ${JSON.stringify(regions)}. Fix every issue below and return the full ${size}×${size} regions matrix as JSON.\n${feedback}` });
          emit({ kind: 'feedback', attempt, message: feedback });
        }
      }

      const attempt = MAX_QUEENS_RETRIES + 1;
      emit({ kind: 'repair', attempt, message: '알고리즘 대체 경로: 같은 정답 배치에서 영역을 다시 만듭니다.' });
      // Workers clocks do not advance during CPU work: bound work, not local elapsed time.
      let restarts = 0, solverCalls = 0;
      while (restarts < MAX_FALLBACK_RESTARTS && solverCalls < MAX_FALLBACK_SOLVER_CALLS - 1) {
        let halted = interrupted(attempt);
        if (halted) return halted;
        restarts++;
        const grown = growRegionsFromSolution(size, solution, random);
        const broken = breakAlternatives(grown, solution, {
          maxSteps: 20, maxSolverCalls: MAX_FALLBACK_SOLVER_CALLS - solverCalls - 1,
        });
        // Reserve one possible solver invocation for the final full validation.
        solverCalls += broken.solverCalls + 1;
        const report = validateDesign({ size, regions: broken.regions }, solution);
        halted = interrupted(attempt);
        if (halted) return halted;
        if (report.valid && report.solutionStatus === 'unique') {
          emit({ kind: 'repair', attempt, message: `알고리즘 대체 경로 완료 · 재시작 ${restarts}회 · solver 예산 ${solverCalls}/${MAX_FALLBACK_SOLVER_CALLS}회` });
          emit({ kind: 'candidate', attempt, regions: broken.regions });
          emit({ kind: 'validation', attempt, report });
          halted = interrupted(attempt);
          if (halted) return halted;
          return complete(broken.regions, attempt);
        }
        // Let request cancellation and other requests run between short CPU batches.
        if (restarts % 2 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      emit({ kind: 'repair', attempt, message: `알고리즘 대체 경로 종료 · 재시작 ${restarts}회 · solver 예산 ${solverCalls}/${MAX_FALLBACK_SOLVER_CALLS}회` });
      return interrupted(attempt) ?? stop('알고리즘 대체 경로의 작업 한도(재시작 500회/solver 1000회)에 도달했지만 유일한 정답을 가진 퍼즐을 만들지 못했습니다.', attempt);
    },
  };
}
