import { isConversation, type ChatEntry, type ChatGateway, type ChatMemory, type ChatState } from '../domain/chat.ts';
import type { StepListener } from '../domain/agent-step.ts';

export function createChat(gateway: ChatGateway, memory?: ChatMemory) {
  const restored = memory?.load();
  let state: ChatState = {
    messages: restored?.ok ? restored.value : [],
    draft: '', pending: false, steps: [],
    error: restored && !restored.ok ? restored.reason : '',
  };
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
      try {
        const result = await gateway.complete(messages.map(({ role, content }) => ({ role, content })), (step) => {
          update({ steps: [...state.steps, step] });
        });
        if (result.ok) {
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

export function createReply(gateway: ChatGateway) {
  return async (body: unknown, onStep?: StepListener) => {
    const messages = body && typeof body === 'object' && 'messages' in body ? body.messages : undefined;
    if (!isConversation(messages)) {
      return { ok: false as const, reason: '메시지를 확인해주세요.', status: 400 };
    }
    const result = await gateway.complete(messages, onStep);
    return result.ok ? result : { ...result, status: 502 };
  };
}
export type Reply = ReturnType<typeof createReply>;
