import type { Logger } from 'pino';
import type { GenerationListener } from '../domain/queens/generation.ts';

const messages = { attempt: 'Queens 생성 시도', tool_call: 'verify_puzzle 호출', validation: 'Queens 검증 결과', feedback: 'Queens 재시도 피드백', complete: 'Queens 생성 완료', stopped: 'Queens 생성 중단' };
export function createQueensLogger(logger: Pick<Logger, 'info' | 'warn'>): GenerationListener {
  return (event) => {
    const level = event.kind === 'feedback' || event.kind === 'stopped' || (event.kind === 'validation' && !event.report.valid) ? 'warn' : 'info';
    logger[level]({ component: 'queens', ...event }, messages[event.kind]);
  };
}
