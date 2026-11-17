import type { Logger } from 'pino';
import type { GenerationListener } from '../domain/queens/generation.ts';

const messages = {
  attempt: 'Queens 생성 시도',
  placement: 'Queens 정답 배치 생성',
  candidate: 'Queens 영역 디자인 제안',
  validation: 'Queens 검증 결과',
  feedback: 'Queens 재시도 피드백',
  repair: 'Queens 코드 보정',
  complete: 'Queens 생성 완료',
  stopped: 'Queens 생성 중단',
};
export function createQueensLogger(logger: Pick<Logger, 'info' | 'warn'>): GenerationListener {
  return (event) => {
    const level = event.kind === 'feedback' || event.kind === 'stopped' || (event.kind === 'validation' && !event.report.valid) ? 'warn' : 'info';
    logger[level]({ component: 'queens', ...event }, messages[event.kind]);
  };
}
