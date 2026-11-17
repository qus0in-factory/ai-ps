import type { Logger } from 'pino';
import type { GenerationListener } from '../domain/queens/generation.ts';

const messages = {
  placement: 'Queens 정답 배치',
  model: 'Queens 모델 제안 처리',
  repair: 'Queens 코드 보정',
  complete: 'Queens 생성 완료',
  stopped: 'Queens 생성 중단',
};
export function createQueensLogger(logger: Pick<Logger, 'info' | 'warn'>): GenerationListener {
  return event => {
    const entry = { component: 'queens', kind: event.kind,
      ...(event.kind === 'model' ? { path: event.path, reason: event.reason } : {}),
      ...(event.kind === 'repair' ? { message: event.message } : {}),
      ...(event.kind === 'stopped' ? { reason: event.reason } : {}),
    };
    logger[event.kind === 'stopped' ? 'warn' : 'info'](entry, messages[event.kind]);
  };
}
