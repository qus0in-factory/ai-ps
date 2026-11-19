import type { ToolLogger } from '../domain/tools.ts';
import type { Logger } from 'pino';

const messages = {
  plan_created: '실행 계획 생성',
  model_request: '모델 요청',
  model_response: '모델 응답',
  model_error: '모델 요청 실패',
  parse_error: 'JSON 파싱 실패',
  loop_stopped: '반복 실행 중단',
  tool_call: '도구 호출',
  tool_result: '도구 실행 결과',
};

// 기본 모드는 요약만 남긴다(설계 §5): content·arguments·result·plan·자유 문장 reason은 빼고
// 원문이 필요한 로컬 개발만 full: true로 본다(그래도 로거의 마스킹은 거친다).
function summarize(entry: Parameters<ToolLogger>[0]): Record<string, unknown> {
  const fields: Record<string, unknown> = { event: entry.event, turn: entry.turn };
  if (entry.phase !== undefined) fields.phase = entry.phase;
  if (entry.stepId !== undefined) fields.stepId = entry.stepId;
  if (entry.event === 'tool_call' || entry.event === 'tool_result') fields.name = entry.name;
  if (entry.event === 'model_response') fields.contentChars = entry.content?.length ?? 0;
  if (entry.event === 'plan_created') fields.steps = entry.plan.steps.length;
  if (entry.event === 'tool_result') fields.ok = entry.result.ok;
  return fields;
}

export function createToolLogger(
  logger: Pick<Logger, 'info' | 'warn' | 'error'>,
  options: { full?: boolean } = {},
): ToolLogger {
  return (entry) => {
    const level = entry.event === 'model_error' ? 'error'
      : entry.event === 'parse_error' || entry.event === 'loop_stopped' ||
        (entry.event === 'tool_result' && !entry.result.ok) ? 'warn' : 'info';
    logger[level](options.full ? entry : summarize(entry), messages[entry.event]);
  };
}
