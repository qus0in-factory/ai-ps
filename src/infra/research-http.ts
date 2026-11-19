/** Fetch-only helpers shared by the research adapters; compatible with Workers. */
export type ResearchAdapterResult<T> = { ok: true; value: T } | { ok: false; reason: string };
export const MAX_RESEARCH_RESPONSE_BYTES = 1024 * 1024;

export async function withResearchDeadline<T>(milliseconds: number | undefined, work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
  const duration = Number.isFinite(milliseconds) ? Math.min(30_000, Math.max(1, milliseconds!)) : 10_000;
  const controller = new AbortController();
  if (external?.aborted) throw new DOMException('Research request cancelled', 'AbortError');
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => { const error = new DOMException('Research request cancelled', 'AbortError'); controller.abort(error); reject(error); };
    external?.addEventListener('abort', cancel, { once: true });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Research request timed out', 'TimeoutError');
      controller.abort(error);
      reject(error);
    }, duration);
  });
  try { return await Promise.race([work(controller.signal), expired, cancelled]); }
  finally { clearTimeout(timer); if (cancel) external?.removeEventListener('abort', cancel); }
}

export function cancelResearchBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

export async function readResearchBody(response: Response, signal: AbortSignal, maxBytes = MAX_RESEARCH_RESPONSE_BYTES): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > maxBytes) {
    cancelResearchBody(response);
    throw new Error('Response exceeds size limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { cancel(); throw new Error('Response exceeds size limit'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export function researchFailure(error: unknown, action: string): ResearchAdapterResult<never> {
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
  return { ok: false, reason: timedOut ? `${action} 시간이 초과되었습니다. 다른 페이지나 검색어를 시도해보세요.`
    : `${action}에 실패했습니다. 다른 페이지나 검색어를 시도해보세요.` };
}
