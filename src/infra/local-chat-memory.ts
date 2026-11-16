import { isConversation, type ChatMemory } from '../domain/chat.ts';

type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>;
const STORAGE_KEY = 'ai-ps.chat.messages';

export function createLocalChatMemory(
  storage: StorageAccess = () => window.localStorage,
): ChatMemory {
  return {
    load() {
      try {
        const stored = storage().getItem(STORAGE_KEY);
        if (stored === null) return { ok: true, value: [] };
        const messages: unknown = JSON.parse(stored);
        if (Array.isArray(messages) && (messages.length === 0 || isConversation(messages))) {
          return { ok: true, value: messages };
        }
        return { ok: false, reason: '저장된 대화를 복원하지 못했습니다.' };
      } catch {
        return { ok: false, reason: '저장된 대화를 복원하지 못했습니다.' };
      }
    },
    save(messages) {
      try {
        storage().setItem(STORAGE_KEY, JSON.stringify(messages));
        return { ok: true, value: undefined };
      } catch {
        return { ok: false, reason: '대화를 저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요.' };
      }
    },
  };
}
