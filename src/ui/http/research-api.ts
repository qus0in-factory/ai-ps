import { Hono } from 'hono';
import type { ResearchResult } from '../../domain/research/types.ts';
import type { ResearchRateLimit } from '../../domain/research/rate-limit.ts';

export interface ResearchRequestMetrics { topicLength: number; iterations: number; toolCalls: number; ms: number }
export interface ResearchApiDependencies {
  run(topic: string, signal: AbortSignal): Promise<{ ok: true; value: ResearchResult } | { ok: false; reason: string }>;
  limit?: ResearchRateLimit;
  log?: (metrics: ResearchRequestMetrics) => void;
}
const MAX_BODY_BYTES = 4096;
function error(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
async function boundedBody(request: Request): Promise<{ ok: true; text: string } | { ok: false; status: number }> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    void request.body?.cancel().catch(() => {}); return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0; let text = ''; let expired = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(() => { expired = true; cancel(); }, 5000);
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (request.signal.aborted || expired) { cancel(); return { ok: false, status: 408 }; }
      const chunk = await reader.read();
      if (request.signal.aborted || expired) return { ok: false, status: 408 };
      if (chunk.done) return { ok: true, text: text + decoder.decode() };
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) { cancel(); return { ok: false, status: 413 }; }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch { return { ok: false, status: 400 }; }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
export function createResearchApi(deps: ResearchApiDependencies) {
  const api = new Hono();
  api.post('/api/research', async c => {
    const status = await deps.limit?.(c.req.header('CF-Connecting-IP') || 'anon') ?? 'allowed';
    if (status === 'limited') return error(429, '잠시 후 다시 시도해 주세요.', { 'Retry-After': '60' });
    if (status !== 'allowed') return error(503, '요청 제한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    const body = await boundedBody(c.req.raw);
    if (!body.ok) return error(body.status, body.status === 413 ? '요청 본문이 너무 큽니다.' : '요청 본문을 읽지 못했습니다.');
    let data: unknown;
    try { data = JSON.parse(body.text); } catch { return error(400, '올바른 JSON 요청이 필요합니다.'); }
    const topic = data && typeof data === 'object' && 'topic' in data ? data.topic : undefined;
    if (typeof topic !== 'string' || !topic.trim() || topic.trim().length > 200) return error(400, '주제는 1~200자로 입력해 주세요.');
    const started = Date.now();
    let result: Awaited<ReturnType<ResearchApiDependencies['run']>>;
    try { result = await deps.run(topic.trim(), c.req.raw.signal); }
    catch { result = { ok: false, reason: '' }; }
    try { deps.log?.({ topicLength: topic.trim().length, iterations: result.ok ? result.value.iterations : 0,
      toolCalls: result.ok ? result.value.steps.length : 0, ms: Date.now() - started }); } catch { /* Metrics cannot change an outcome. */ }
    return result.ok ? Response.json(result.value, { headers: { 'Cache-Control': 'no-store' } })
      : error(502, '일시적으로 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  });
  api.all('/api/research', () => error(405, 'POST 요청만 가능합니다.', { Allow: 'POST' }));
  api.notFound(() => error(404, '요청한 API를 찾을 수 없습니다.'));
  api.onError(() => error(502, '일시적으로 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.'));
  return api;
}
