import type { Result } from '../domain/chat.ts';

export type ResearchToolName = 'search_web' | 'read_webpage';

export interface ResearchStep {
  tool: ResearchToolName;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ResearchEvaluation {
  passed: boolean;
  problems: string[];
}

export interface ResearchResult {
  report: string;
  steps: ResearchStep[];
  sources: string[];
  iterations: number;
  capped: boolean;
  evaluation?: ResearchEvaluation;
}

export interface ResearchClient {
  run(topic: string, signal?: AbortSignal): Promise<Result<ResearchResult>>;
}

export const RESEARCH_TOPIC_MAX = 200;
// 조사는 max_iterations=10 까지 모델·검색·페이지 읽기를 반복하므로 넉넉히 잡는다.
export const RESEARCH_TIMEOUT_MS = 600_000;

const REPORT_MAX = 200_000;
const STEPS_MAX = 200;
const SOURCES_MAX = 200;
const SOURCE_URL_MAX = 2_000;
const ITERATIONS_MAX = 100;
const ERROR_MAX = 1_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isStep(value: unknown): value is ResearchStep {
  if (!record(value) || !only(value, ['tool', 'args', 'ok'])) return false;
  if (value.tool !== 'search_web' && value.tool !== 'read_webpage') return false;
  if (typeof value.ok !== 'boolean' || !record(value.args)) return false;
  const args = Object.values(value.args);
  return args.length <= 10 && args.every((arg) => typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean');
}

function isEvaluation(value: unknown): value is ResearchEvaluation {
  if (!record(value) || !only(value, ['passed', 'problems'])) return false;
  return typeof value.passed === 'boolean'
    && Array.isArray(value.problems)
    && value.problems.length <= 20
    && value.problems.every((item) => typeof item === 'string' && item.length <= ERROR_MAX);
}

function isResearchResult(value: unknown): value is ResearchResult {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  const baseKeys = ['report', 'steps', 'sources', 'iterations', 'capped'];
  const allowedKeys = [...baseKeys, 'evaluation'];
  if (!baseKeys.every((key) => keys.includes(key)) || !keys.every((key) => allowedKeys.includes(key))) return false;
  if (value.evaluation !== undefined && !isEvaluation(value.evaluation)) return false;
  return text(value.report, REPORT_MAX)
    && Array.isArray(value.steps) && value.steps.length <= STEPS_MAX && value.steps.every(isStep)
    && Array.isArray(value.sources) && value.sources.length <= SOURCES_MAX
    && value.sources.every((source) => typeof source === 'string' && source.length <= SOURCE_URL_MAX)
    && typeof value.iterations === 'number' && Number.isInteger(value.iterations)
    && value.iterations >= 0 && value.iterations <= ITERATIONS_MAX
    && typeof value.capped === 'boolean';
}

export function createHttpResearch(fetcher: typeof fetch = fetch): ResearchClient {
  return {
    async run(topic, external) {
      const trimmed = topic.trim();
      if (!trimmed || trimmed.length > RESEARCH_TOPIC_MAX) {
        return { ok: false, reason: `주제는 1~${RESEARCH_TOPIC_MAX}자로 입력해 주세요.` };
      }
      const timeout = AbortSignal.timeout(RESEARCH_TIMEOUT_MS);
      const signal = external ? AbortSignal.any([external, timeout]) : timeout;
      const cancelled = { ok: false as const, reason: '조사 요청이 중단되었거나 시간이 초과되었습니다.' };
      if (signal.aborted) return cancelled;
      let cancel: (() => void) | undefined;
      try {
        const aborted = new Promise<typeof cancelled>((resolve) => {
          cancel = () => resolve(cancelled);
          signal.addEventListener('abort', cancel, { once: true });
        });
        const response = (async (): Promise<Result<ResearchResult>> => {
          const response = await fetcher('/api/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ topic: trimmed }),
            signal,
          });
          if (response.status === 429) return { ok: false, reason: '잠시 후 다시 시도해 주세요.' };
          if (!response.ok) {
            const problem: unknown = await response.json().catch(() => null);
            return {
              ok: false,
              reason: record(problem) && text(problem.error, ERROR_MAX) ? problem.error : '조사 요청을 처리하지 못했습니다.',
            };
          }
          const value: unknown = await response.json().catch(() => null);
          return isResearchResult(value) ? { ok: true, value } : { ok: false, reason: '올바른 조사 결과를 받지 못했습니다.' };
        })();
        const result = await Promise.race([response, aborted]);
        return signal.aborted ? cancelled : result;
      } catch {
        return signal.aborted ? cancelled : { ok: false, reason: '조사 서버에 연결하지 못했습니다. 다시 시도해 주세요.' };
      } finally {
        if (cancel) signal.removeEventListener('abort', cancel);
      }
    },
  };
}
