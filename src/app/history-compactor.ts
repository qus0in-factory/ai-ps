// 히스토리 요약(설계 /tmp/token-spec.md §6·§15). /chat 전용: 요약은 max 초과 시에만 한 번,
// 그 사이에는 뒤에 붙이기만 해서 프롬프트 캐시 접두어를 지킨다. 요약 실패 시 최근 keep개만 남긴다.

import type { ChatMessage } from '../domain/chat.ts';
import type { CompletionGateway } from '../domain/completion.ts';
import { budget } from '../domain/token-budget.ts';

const SUMMARY_PROMPT = [
  'Summarize the conversation so far for an assistant that continues it.',
  'Keep the conversation language, key facts, decisions, names and unresolved questions.',
  'Plain text only.',
].join('\n');

/** 압축이 일어나지 않으면 입력 배열을 그대로(같은 참조) 돌려준다. */
export type CompactHistory = (messages: ChatMessage[]) => Promise<ChatMessage[]>;

export function createHistoryCompactor(
  model: CompletionGateway,
  options: { max?: number; keep?: number } = {},
): CompactHistory {
  const max = options.max ?? 12;
  const keep = options.keep ?? 6;
  return async (messages) => {
    if (messages.length <= max) return messages;
    const front = messages.slice(0, Math.max(0, messages.length - keep));
    const recent = messages.slice(-keep);
    let summary: string | undefined;
    try {
      const result = await model.complete(
        [{ role: 'system', content: SUMMARY_PROMPT }, ...front],
        { ...budget('summary'), reasoning_effort: 'none' },
      );
      summary = result.ok ? result.value.content?.trim() || undefined : undefined;
    } catch { summary = undefined; }
    return summary ? [{ role: 'user', content: `[이전 대화 요약]\n${summary}` }, ...recent] : recent;
  };
}
