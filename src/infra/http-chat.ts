import type { ChatGateway, ChatMessage, Result } from '../domain/chat.ts';
import { isConversation } from '../domain/chat.ts';
import { isAgentStep, type StepListener } from '../domain/agent-step.ts';

async function readProgress(
  response: Response, signal: AbortSignal, onStep?: StepListener, onContext?: (context: ChatMessage[]) => void,
): Promise<Result<string>> {
  if (!response.body) return { ok: false, reason: '응답 스트림을 읽지 못했습니다.' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let buffer = '';
  let result: Result<string> | undefined;
  const consume = (line: string) => {
    if (!line.trim() || result) return;
    const frame = JSON.parse(line);
    if (frame.type === 'step' && isAgentStep(frame.step)) onStep?.(frame.step);
    else if (frame.type === 'result' && typeof frame.content === 'string' && frame.content.trim()) {
      if (isConversation(frame.context)) onContext?.(frame.context);
      result = { ok: true, value: frame.content };
    } else if (frame.type === 'problem') {
      result = { ok: false, reason: typeof frame.problem?.detail === 'string' ? frame.problem.detail : '요청을 처리하지 못했습니다.' };
    } else throw new Error('Invalid progress frame');
  };
  try {
    while (true) {
      if (signal.aborted) return { ok: false, reason: '응답 시간이 초과되었습니다. 다시 시도해주세요.' };
      const { done, value } = await reader.read();
      if (signal.aborted) return { ok: false, reason: '응답 시간이 초과되었습니다. 다시 시도해주세요.' };
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (result) return result;
      }
      if (done) break;
    }
    consume(buffer);
    return result ?? { ok: false, reason: '답변이 완료되기 전에 연결이 종료되었습니다.' };
  } catch {
    if (signal.aborted) return { ok: false, reason: '응답 시간이 초과되었습니다. 다시 시도해주세요.' };
    return { ok: false, reason: '진행 상황 응답을 읽지 못했습니다. 다시 시도해주세요.' };
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

/** 최근 성공 응답이 압축 컨텍스트를 실었을 때만 정의된다(요청마다 다시 채워진다). */
export interface ContextChatGateway extends ChatGateway {
  lastContext?: ChatMessage[];
}

export function createHttpChat(fetcher: typeof fetch = fetch, timeoutMs = 90_000): ContextChatGateway {
  const gateway: ContextChatGateway = {
    async complete(messages, onStep) {
      gateway.lastContext = undefined;
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetcher('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson, application/json, application/problem+json',
          },
          body: JSON.stringify({ messages }),
          signal,
        });
        const mediaType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
        if (response.ok && mediaType === 'application/x-ndjson') return await readProgress(response, signal, onStep, context => { gateway.lastContext = context; });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const detail = mediaType === 'application/problem+json' && typeof data?.detail === 'string' ? data.detail : '';
          const title = mediaType === 'application/problem+json' && typeof data?.title === 'string' ? data.title : '';
          return { ok: false, reason: detail || title || `응답을 가져오지 못했습니다. (HTTP ${response.status})` };
        }
        if (isConversation(data?.context)) gateway.lastContext = data.context;
        if (typeof data?.content !== 'string' || !data.content) {
          return { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
        }
        return { ok: true, value: data.content };
      } catch {
        if (signal.aborted) return { ok: false, reason: '응답 시간이 초과되었습니다. 다시 시도해주세요.' };
        return { ok: false, reason: '연결을 확인해주세요.' };
      }
    },
  };
  return gateway;
}
