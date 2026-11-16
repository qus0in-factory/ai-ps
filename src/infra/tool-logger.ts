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

export function createToolLogger(logger: Pick<Logger, 'info' | 'warn' | 'error'>): ToolLogger {
  return (entry) => {
    const level = entry.event === 'model_error' ? 'error'
      : entry.event === 'parse_error' || entry.event === 'loop_stopped' ||
        (entry.event === 'tool_result' && !entry.result.ok) ? 'warn' : 'info';
    logger[level](entry, messages[entry.event]);
  };
}
