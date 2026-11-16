import type { ChatGateway } from '../domain/chat.ts';

export function createHttpChat(fetcher: typeof fetch = fetch): ChatGateway {
  return {
    async complete(messages) {
      try {
        const response = await fetcher('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });
        const data = await response.json();
        if (!response.ok) return { ok: false, reason: data.error || '응답을 가져오지 못했습니다.' };
        if (typeof data.content !== 'string' || !data.content) {
          return { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
        }
        return { ok: true, value: data.content };
      } catch {
        return { ok: false, reason: '연결을 확인해주세요.' };
      }
    },
  };
}
