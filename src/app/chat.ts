import { isConversation, type ChatEntry, type ChatGateway, type ChatMemory, type ChatMessage, type ChatState } from '../domain/chat.ts';
import type { StepListener } from '../domain/agent-step.ts';
import type { CompactHistory } from './history-compactor.ts';

/** http-chat 게이트웨이가 압축 응답에서 읽은 전송용 컨텍스트. 요청마다 다시 채워진다(없으면 undefined). */
type ContextCarrier = { lastContext?: ChatMessage[] };

export function createChat(gateway: ChatGateway & ContextCarrier, memory?: ChatMemory) {
  const restored = memory?.load();
  let state: ChatState = {
    messages: restored?.ok ? restored.value : [],
    draft: '', pending: false, steps: [],
    error: restored && !restored.ok ? restored.reason : '',
  };
  let sendContext: ChatMessage[] | undefined; // 화면용과 별개인 전송용 히스토리(압축이 일어난 뒤에만 존재)
  const listeners = new Set<(state: ChatState) => void>();
  const update = (patch: Partial<ChatState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };
  return {
    getState: () => state,
    subscribe(listener: (state: ChatState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setDraft(draft: string) { update({ draft }); },
    async send(draft = state.draft) {
      const content = draft.trim();
      if (!content || state.pending) return;
      const previous = state.messages;
      const messages: ChatEntry[] = [...previous, { role: 'user', content }];
      update({ messages, draft: '', pending: true, error: '', steps: [] });
      const outgoing: ChatMessage[] = [
        ...(sendContext ?? previous.map(({ role, content }) => ({ role, content }))),
        { role: 'user', content },
      ];
      try {
        const result = await gateway.complete(outgoing, (step) => {
          update({ steps: [...state.steps, step] });
        });
        if (result.ok) {
          // 압축 컨텍스트를 받으면 그 뒤에 이번 답변만 붙여 다음 전송 분량을 유지한다(재정렬 금지).
          const carried = gateway.lastContext;
          sendContext = carried
            ? [...carried, { role: 'assistant', content: result.value }]
            : sendContext ? [...outgoing, { role: 'assistant', content: result.value }] : undefined;
          const completed: ChatEntry[] = [...messages, {
            role: 'assistant', content: result.value,
            ...(state.steps.length ? { steps: state.steps } : {}),
          }];
          const saved = memory?.save(completed.map(({ role, content }) => ({ role, content })));
          update({
            messages: completed, pending: false, steps: [],
            error: saved && !saved.ok ? saved.reason : '',
          });
        } else {
          update({ messages: previous, draft: content, pending: false, error: result.reason });
        }
      } catch {
        update({ messages: previous, draft: content, error: '요청을 처리하지 못했습니다. 다시 시도해주세요.' });
      } finally {
        update({ pending: false });
      }
    },
  };
}
export type ChatController = ReturnType<typeof createChat>;

export function createReply(gateway: ChatGateway, compact?: CompactHistory) {
  return async (body: unknown, onStep?: StepListener) => {
    const messages = body && typeof body === 'object' && 'messages' in body ? body.messages : undefined;
    if (!isConversation(messages)) {
      return { ok: false as const, reason: '메시지를 확인해주세요.', status: 400 };
    }
    const context = compact ? await compact(messages) : messages;
    const result = await gateway.complete(context, onStep);
    if (!result.ok) return { ...result, status: 502 };
    const payload: { ok: true; value: string; context?: ChatMessage[] } =
      context !== messages ? { ...result, context } : result;
    return payload;
  };
}
export type Reply = ReturnType<typeof createReply>;
