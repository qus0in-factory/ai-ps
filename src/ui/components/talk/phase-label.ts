import type { TalkPhase } from '../../../domain/talk/types.ts';
import { atLimit, canSend, type TalkView } from '../../../app/talk/session-store.ts';
export function phaseLabel(phase: TalkPhase): string {
  return { idle: '준비되었어요', thinking: '튜터가 답을 준비하고 있어요…', reporting: '학습 보고서를 만들고 있어요…', ended: '오늘의 연습 완료' }[phase];
}
export function draftHint(view: TalkView): string {
  if (atLimit(view)) return '기록 한도에 도달했어요. 연습을 마치고 보고서를 받아보세요.';
  if (view.learnerText.trim() && !canSend({ ...view, phase: 'idle' })) return '입력이 너무 길거나 기록 용량이 부족해요. 짧게 입력하거나 연습을 마쳐주세요.';
  return '일본어로 편하게 적어보세요. 최대 500자까지 보낼 수 있어요.';
}
