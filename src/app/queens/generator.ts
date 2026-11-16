import type { CompletionMessage, FunctionCompletionGateway } from '../../domain/completion.ts';
import { validateGrid } from '../../domain/queens/grid.ts';
import { isPuzzleValidation, MAX_QUEENS_RETRIES, type GenerationListener, type QueensGenerator } from '../../domain/queens/generation.ts';
import type { PuzzleValidation } from '../../domain/queens/types.ts';
import type { Tool } from '../../domain/tools.ts';

const invalid = (message: string): PuzzleValidation => ({ valid: false, solutionStatus: 'invalid', solutions: [], nodesVisited: 0,
  issues: [{ code: 'INVALID_GRID', message }] });

export function createQueensGenerator(model: FunctionCompletionGateway, verify: Tool, log?: GenerationListener): QueensGenerator {
  return {
    async generate(size, onEvent, signal) {
      if (!Number.isInteger(size) || size < 5 || size > 9) return { ok: false, reason: '격자 크기는 5부터 9까지의 정수여야 합니다.' };
      const emit: GenerationListener = (event) => { log?.(event); onEvent?.(event); };
      const stop = (reason: string, attempt: number) => {
        emit({ kind: 'stopped', attempt, reason });
        return { ok: false as const, reason };
      };
      const messages: CompletionMessage[] = [{ role: 'system', content: [
        'Create a LinkedIn Queens puzzle directly. You are responsible for inventing the entire colored grid yourself.',
        `The requested size is exactly ${size}×${size}. Provide size:${size} and a square regions matrix of integer color IDs.`,
        `There must be exactly ${size} color regions. Every cell belongs to one region. Each region must be connected by up/down/left/right edges, not just diagonally.`,
        `A solution places exactly ${size} queens: one in each row, each column, and each color region. Queens cannot touch, even diagonally. Distant diagonals are allowed.`,
        'The puzzle must have exactly one solution. Always call verify_puzzle with your full proposed grid to check it.',
        'When validation fails, read all issues and the example solutions if present. Revise the grid and call verify_puzzle again.',
        'Do not output a solved placement, explanation, planning steps or a procedural generation algorithm. Propose the whole grid directly.',
      ].join('\n') }, { role: 'user', content: `${size}×${size} Queens 퍼즐을 만들어 verify_puzzle로 검증해주세요.` }];
      for (let retry = 0; retry <= MAX_QUEENS_RETRIES; retry++) {
        const attempt = retry + 1;
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.', attempt);
        emit({ kind: 'attempt', attempt, retry });
        const response = await model.complete(messages, [verify.definition], {
          temperature: 0.8, parallel_tool_calls: false,
          tool_choice: { type: 'function', function: { name: 'verify_puzzle' } }, signal,
        });
        if (!response.ok) return stop(response.reason, attempt);
        if (signal?.aborted) return stop('퍼즐 생성을 중단했습니다.', attempt);
        const message = response.value;
        const calls = message.tool_calls ?? [];
        messages.push(message);
        let feedback = 'verify_puzzle 도구를 정확히 한 번 호출하고 전체 격자를 제출해주세요.';
        if (!calls.length) {
          messages.push({ role: 'user', content: feedback });
        } else {
          for (const call of calls) {
            let args: unknown;
            let report: PuzzleValidation;
            try { args = JSON.parse(call.function.arguments); }
            catch { args = null; }
            emit({ kind: 'tool_call', attempt, arguments: args });
            if (calls.length !== 1 || call.function.name !== 'verify_puzzle') report = invalid(feedback);
            else if (!args || typeof args !== 'object' || !('size' in args) || args.size !== size) report = invalid(`요청한 크기는 ${size}×${size}입니다. size와 regions 크기를 맞춰주세요.`);
            else {
              const checked = await verify.execute(args);
              report = checked.ok && isPuzzleValidation(checked.value) ? checked.value : invalid(checked.ok ? '검증 결과를 읽지 못했습니다.' : checked.reason);
            }
            emit({ kind: 'validation', attempt, report });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(report) });
            if (report.valid && report.solutionStatus === 'unique') {
              const grid = validateGrid(args);
              if (grid.valid && report.solutions[0]) {
                emit({ kind: 'complete', attempt });
                return { ok: true, value: { puzzle: grid.puzzle, solution: report.solutions[0], attempts: attempt } };
              }
            }
            feedback = report.issues.map(issue => `${issue.code}: ${issue.message}`).join('\n') || '유일한 정답이 있는지 확정하지 못했습니다.';
          }
          messages.push({ role: 'user', content: `검증 실패입니다. 다음 피드백을 바탕으로 격자를 수정하세요.\n${feedback}` });
        }
        emit({ kind: 'feedback', attempt, message: feedback });
      }
      return stop(`최초 생성과 ${MAX_QUEENS_RETRIES}회 재시도 후에도 유일한 정답을 가진 퍼즐을 만들지 못했습니다.`, MAX_QUEENS_RETRIES + 1);
    },
  };
}
