import { isGenerationEvent, type QueensGenerator } from '../domain/queens/generation.ts';
import { validateGrid } from '../domain/queens/grid.ts';
import { validatePlacement } from '../domain/queens/placement.ts';
import type { GeneratedPuzzle } from '../domain/queens/types.ts';
import { readJsonLines } from './json-lines.ts';

export function createHttpQueensGenerator(fetcher: typeof fetch = fetch): QueensGenerator {
  return {
    async generate(size, onEvent, externalSignal) {
      const timeout = AbortSignal.timeout(300_000);
      const signal = externalSignal ? AbortSignal.any([timeout, externalSignal]) : timeout;
      try {
        const response = await fetcher('/api/queens/generate', { method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/problem+json' },
          body: JSON.stringify({ size }),
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => null);
          return { ok: false, reason: typeof problem?.detail === 'string' ? problem.detail : `생성 요청 실패 (HTTP ${response.status})` };
        }
        for await (const value of readJsonLines(response, signal)) {
          if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid frame');
          if (value.type === 'event' && 'event' in value && isGenerationEvent(value.event)) onEvent?.(value.event);
          else if (value.type === 'problem' && 'problem' in value) {
            const problem = value.problem as { detail?: unknown };
            return { ok: false, reason: typeof problem?.detail === 'string' ? problem.detail : '퍼즐 생성에 실패했습니다.' };
          } else if (value.type === 'result' && 'value' in value) {
            const generated = value.value as GeneratedPuzzle;
            const grid = validateGrid(generated?.puzzle);
            if (grid.valid && grid.puzzle.size === size && validatePlacement(grid.puzzle, generated.solution).valid) return { ok: true, value: generated };
            throw new Error('Invalid puzzle');
          } else throw new Error('Invalid frame');
        }
        return { ok: false, reason: '결과를 받기 전에 연결이 종료되었습니다.' };
      } catch {
        return { ok: false, reason: signal.aborted ? '생성이 중단되었거나 요청 시간이 초과되었습니다.' : '퍼즐 생성 응답을 읽지 못했습니다.' };
      }
    },
  };
}
