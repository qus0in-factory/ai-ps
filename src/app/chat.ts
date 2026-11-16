import { isConversation, type ChatGateway, type ChatMemory, type ChatMessage, type ChatState } from '../domain/chat.ts';

export function createChat(gateway: ChatGateway, memory?: ChatMemory) {
  const restored = memory?.load();
  let state: ChatState = {
    messages: restored?.ok ? restored.value : [],
    draft: '', pending: false,
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
      const messages: ChatMessage[] = [...previous, { role: 'user', content }];
      update({ messages, draft: '', pending: true, error: '' });
      const result = await gateway.complete(messages);
      if (result.ok) {
        const completed: ChatMessage[] = [...messages, { role: 'assistant', content: result.value }];
        const saved = memory?.save(completed);
        update({
          messages: completed, pending: false,
          error: saved && !saved.ok ? saved.reason : '',
        });
      } else {
        update({ messages: previous, draft: content, pending: false, error: result.reason });
      }
    },
  };
}
export type ChatController = ReturnType<typeof createChat>;

export function createReply(gateway: ChatGateway) {
  return async (body: unknown) => {
    const messages = body && typeof body === 'object' && 'messages' in body ? body.messages : undefined;
    if (!isConversation(messages)) {
      return { ok: false as const, reason: '메시지를 확인해주세요.', status: 400 };
    }
    const result = await gateway.complete(messages);
    return result.ok ? result : { ...result, status: 502 };
  };
}
export type Reply = ReturnType<typeof createReply>;
