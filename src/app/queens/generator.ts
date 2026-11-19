import type { ChatMessage } from '../../domain/chat.ts';
import type { CompletionGateway, JsonSchemaResponseFormat } from '../../domain/completion.ts';
import { validateDesign } from '../../domain/queens/design.ts';
import type { GenerationListener, GenerationPath, QueensGenerator } from '../../domain/queens/generation.ts';
import { createRandomSolution } from '../../domain/queens/random-solution.ts';
import { validateGrid } from '../../domain/queens/grid.ts';
import { breakAlternatives, growRegionsFromProposal, growRegionsFromSolution, growSmallRegions, repairDisconnected } from '../../domain/queens/repair.ts';
import type { QueensSolution, RegionId } from '../../domain/queens/types.ts';
import { budget } from '../../domain/token-budget.ts';

interface GeneratorOptions {
  place?: (size: number) => QueensSolution;
  log?: GenerationListener;
  now?: () => number;
  random?: () => number;
}

const MODEL_TIMEOUT_MS = 20_000;
const GENERATION_TIMEOUT_MS = 290_000;
const MAX_MODEL_SEED_RESTARTS = 100;
const MAX_MODEL_SEED_SOLVER_CALLS = 2000;
const MAX_FALLBACK_RESTARTS = 500;
const MAX_FALLBACK_SOLVER_CALLS = 4000;
const TIMEOUT_REASON = '퍼즐 생성 제한 시간(290초)을 초과했습니다.';
const PROPOSAL_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'queens_proposal',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'string' } },
      },
      required: ['rows'],
      additionalProperties: false,
    },
  },
};

// 축약(설계 §5·§14): 크기는 요청마다 바뀌므로 system이 아니라 user 메시지의 {size}에만 둔다.
const QUEENS_PROPOSAL_PROMPT = [
  'Propose varied connected color regions around the fixed queens of the requested grid; code will finish the puzzle.',
  'Every region contains exactly one given queen; keep the queens in place. Prefer regions with at least 3 cells; at most one region may have 2 cells.',
  'Each row is one string of single-digit region IDs, one ID per cell and no spaces, sized to the requested grid.',
].join('\n');

// A missing region is a semantic defect, not a malformed matrix; it can still seed growth.
// size <= 9: region IDs are 0..8, and the final check is Number(char) < size.
function parseProposal(content: string, size: number): RegionId[][] | undefined {
  try {
    const data = JSON.parse(content);
    const raw = data.rows ?? data.regions;
    const regions = Array.isArray(raw) && raw.every(row => typeof row === 'string')
      ? raw.map(row => row.replace(/\s/g, '').split('').map(char => /^[0-8]$/.test(char) && Number(char) < size ? Number(char) : NaN))
      : raw;
    const grid = validateGrid({ size, regions });
    if (grid.valid || !grid.issues.some(issue => issue.code === 'INVALID_GRID')) return regions as RegionId[][];
  } catch { /* Optional malformed proposal. */ }
}

// The model is optional: even a gateway that ignores AbortSignal cannot delay fallback.
async function propose(model: CompletionGateway, messages: ChatMessage[], signal: AbortSignal) {
  let cancel!: () => void;
  const aborted = new Promise<{ ok: false; reason: string }>(resolve => {
    cancel = () => resolve({ ok: false, reason: '모델 응답 시간 초과' });
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    if (signal.aborted) { cancel(); return await aborted; }
    return await Promise.race([model.complete(messages, {
      response_format: PROPOSAL_RESPONSE_FORMAT, signal, ...budget('queensProposal'),
    }), aborted]);
  } catch { return { ok: false as const, reason: '모델 요청 실패' }; }
  finally { signal.removeEventListener('abort', cancel); }
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
      const emit: GenerationListener = event => { options.log?.(event); onEvent?.(event); };
      const stop = (reason: string) => {
        emit({ kind: 'stopped', reason });
        return { ok: false as const, reason };
      };
      const interrupted = () => {
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.');
        if (deadline.aborted || now() >= expiresAt) return stop(TIMEOUT_REASON);
      };
      const solution = place(size);
      const complete = (regions: RegionId[][], message: string, path: GenerationPath, reason?: string) => {
        emit({ kind: 'model', path, ...(reason ? { reason } : {}) });
        emit({ kind: 'repair', message });
        const halted = interrupted();
        if (halted) return halted;
        emit({ kind: 'complete' });
        return { ok: true as const, value: { puzzle: { size, regions }, solution } };
      };
      emit({ kind: 'placement' });
      let halted = interrupted();
      if (halted) return halted;

      const modelDeadline = AbortSignal.timeout(MODEL_TIMEOUT_MS);
      const modelSignal = AbortSignal.any([requestSignal, modelDeadline]);
      const response = await propose(model, [
        { role: 'system', content: QUEENS_PROPOSAL_PROMPT },
        { role: 'user', content: JSON.stringify({ size, queens: solution }) },
      ], modelSignal);
      halted = interrupted();
      if (halted) return halted;

      let reason = modelDeadline.aborted ? '모델 응답 시간 초과' : '모델 요청 실패';
      let modelSeed: RegionId[][] | undefined;
      if (response.ok && !modelDeadline.aborted) {
        modelSeed = parseProposal(response.value.content ?? '', size);
        if (modelSeed) {
          const grid = validateGrid({ size, regions: modelSeed });
          if (grid.valid || grid.issues.every(issue => issue.code === 'DISCONNECTED_REGION')) {
            const connected = repairDisconnected(modelSeed, solution);
            const grown = growSmallRegions(connected, solution);
            const broken = breakAlternatives(grown, solution, { maxSteps: 20 });
            const report = validateDesign({ size, regions: broken.regions }, solution);
            halted = interrupted();
            if (halted) return halted;
            if (report.valid && report.solutionStatus === 'unique') {
              return complete(broken.regions, '코드 보정 완료 · 모델 제안 검증', 'model');
            }
          }
          reason = '모델 배치를 유일해로 보정하지 못함';
        } else reason = '모델 배치 형식 오류';
      }

      // Give model-shaped starts a separate work allowance; preserve the pure fallback budget.
      for (const seed of modelSeed ? [modelSeed, undefined] : [undefined]) {
        const maxRestarts = seed ? MAX_MODEL_SEED_RESTARTS : MAX_FALLBACK_RESTARTS;
        const maxSolverCalls = seed ? MAX_MODEL_SEED_SOLVER_CALLS : MAX_FALLBACK_SOLVER_CALLS;
        let restarts = 0, solverCalls = 0;
        while (restarts < maxRestarts && solverCalls < maxSolverCalls - 1) {
          halted = interrupted();
          if (halted) return halted;
          restarts++;
          const seeded = seed ? growRegionsFromProposal(seed, solution, random) : undefined;
          if (seeded && seeded.retainedCells === 0) { reason = '모델 시드로 유지할 이웃 셀 없음'; break; }
          const grown = seeded?.regions ?? growRegionsFromSolution(size, solution, random);
          const broken = breakAlternatives(grown, solution, { maxSteps: 20, maxSolverCalls: maxSolverCalls - solverCalls - 1 });
          solverCalls += broken.solverCalls + 1;
          const report = validateDesign({ size, regions: broken.regions }, solution);
          halted = interrupted();
          if (halted) return halted;
          if (report.valid && report.solutionStatus === 'unique') {
            return complete(broken.regions, `코드 보정 완료 · 재시작 ${restarts}회 · solver 예산 ${solverCalls}/${maxSolverCalls}회${seeded ? ` · 모델 시드 ${seeded.retainedCells}칸으로 시작` : ''}`,
              seed ? 'model-seed' : 'algorithm', reason);
          }
          if (restarts % 2 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (seed) {
          if (solverCalls > 0) reason = '모델 시드 탐색 한도 소진';
        } else {
          emit({ kind: 'model', path: 'algorithm', reason });
          emit({ kind: 'repair', message: `코드 보정 중단 · 재시작 ${restarts}회 · solver 예산 ${solverCalls}/${maxSolverCalls}회` });
        }
      }
      return interrupted() ?? stop('알고리즘 대체 경로의 작업 한도(재시작 500회/solver 4000회)에 도달했지만 유일한 정답을 가진 퍼즐을 만들지 못했습니다.');
    },
  };
}
