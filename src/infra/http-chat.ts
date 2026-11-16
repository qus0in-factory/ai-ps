import type { ChatGateway } from '../domain/chat.ts';

export function createHttpChat(fetcher: typeof fetch = fetch): ChatGateway {
  return {
    async complete(messages) {
      try {
        const response = await fetcher('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, application/problem+json',
          },
          body: JSON.stringify({ messages }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const mediaType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
          const detail = mediaType === 'application/problem+json' && typeof data?.detail === 'string' ? data.detail : '';
          const title = mediaType === 'application/problem+json' && typeof data?.title === 'string' ? data.title : '';
          return { ok: false, reason: detail || title || `응답을 가져오지 못했습니다. (HTTP ${response.status})` };
        }
        if (typeof data?.content !== 'string' || !data.content) {
          return { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
        }
        return { ok: true, value: data.content };
      } catch {
        return { ok: false, reason: '연결을 확인해주세요.' };
      }
    },
  };
}
