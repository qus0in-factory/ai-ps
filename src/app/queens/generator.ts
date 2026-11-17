import type { ChatMessage } from '../../domain/chat.ts';
import type { CompletionGateway } from '../../domain/completion.ts';
import { validateDesign } from '../../domain/queens/design.ts';
import { MAX_QUEENS_RETRIES, type GenerationListener, type QueensGenerator } from '../../domain/queens/generation.ts';
import { createRandomSolution } from '../../domain/queens/random-solution.ts';
import type { PuzzleValidation, QueensPuzzle, QueensSolution, RegionId } from '../../domain/queens/types.ts';

interface GeneratorOptions {
  place?: (size: number) => QueensSolution;
  log?: GenerationListener;
  now?: () => number;
}

const CALL_TIMEOUT_MS = 180_000;
// Leave time to deliver the final event before the browser's 300 s deadline.
const GENERATION_TIMEOUT_MS = 290_000;
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
  const place = options.place ?? ((size: number) => createRandomSolution(size, Math.random));
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

      const solution = place(size);
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
          timeoutMs: Math.min(CALL_TIMEOUT_MS, remainingMs),
        });
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.', attempt);
        if (expired()) return stop(TIMEOUT_REASON, attempt);
        if (!response.ok) return stop(response.reason, attempt);

        const content = response.value.content ?? '';
        let regions: unknown = null;
        let parsed = true;
        try {
          const data: unknown = JSON.parse(content);
          if (data && typeof data === 'object' && 'regions' in data) regions = (data as { regions: unknown }).regions;
          else parsed = false;
        } catch { parsed = false; }
        emit({ kind: 'candidate', attempt, regions });

        const report = parsed
          ? validateDesign({ size, regions: regions as RegionId[][] }, solution)
          : invalid('응답이 {"regions": [...]} 형태의 JSON이 아닙니다. 크기에 맞는 영역 행렬만 출력하세요.');
        emit({ kind: 'validation', attempt, report });
        if (expired()) return stop(TIMEOUT_REASON, attempt);

        if (report.valid && report.solutionStatus === 'unique') {
          emit({ kind: 'complete', attempt });
          const puzzle: QueensPuzzle = { size, regions: regions as RegionId[][] };
          return { ok: true, value: { puzzle, solution: report.solutions[0] ?? solution, attempts: attempt } };
        }

        const feedback = report.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n') ||
          'UNKNOWN: 검증 결과를 확인하지 못했습니다.';
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: `The region design failed validation. Fix every issue below and return the full ${size}×${size} regions matrix as JSON.\n${feedback}` });
        emit({ kind: 'feedback', attempt, message: feedback });
      }
      return stop(expired() ? TIMEOUT_REASON : `최초 생성과 ${MAX_QUEENS_RETRIES}회 재시도 후에도 유일한 정답을 가진 퍼즐을 만들지 못했습니다.`, MAX_QUEENS_RETRIES + 1);
    },
  };
}
