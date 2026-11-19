import type { Logger } from 'pino';
import type { GenerationListener } from '../domain/queens/generation.ts';

const messages = {
  placement: 'Queens 정답 배치',
  model: 'Queens 모델 제안 처리',
  repair: 'Queens 코드 보정',
  complete: 'Queens 생성 완료',
  stopped: 'Queens 생성 중단',
};
/** 자유 문장(reason·message)은 패턴 마스킹만으로 새 문장이 남을 수 있어 운영 로그에서 제외한다. 구조 필드만 남긴다. */
export function createQueensLogger(logger: Pick<Logger, 'info' | 'warn'>): GenerationListener {
  return event => {
    const entry = { component: 'queens', kind: event.kind,
      ...(event.kind === 'model' ? { path: event.path } : {}),
    };
    logger[event.kind === 'stopped' ? 'warn' : 'info'](entry, messages[event.kind]);
  };
}
