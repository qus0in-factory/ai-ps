import { checkTalkRateLimit } from '../../app/talk/rate-limit.ts';
import { getPath } from 'hono/utils/url';
import { createProblem } from '../../app/problem.ts';
import type { TalkRateLimitBindings } from '../../domain/talk/rate-limit.ts';
import type { TalkLogListener } from '../../domain/talk/logging.ts';

export async function limitTalkRequest(request: Request, bindings: TalkRateLimitBindings, log: TalkLogListener): Promise<Response | undefined> {
  const path = getPath(request);
  const result = await checkTalkRateLimit(path, request.headers.get('CF-Connecting-IP') || 'anon', bindings);
  if (result === 'allowed') return;
  if (result === 'limited') {
    try { log({ event: 'rate_limited', path, ok: false }); } catch { /* Never bypass the gate on logger failure. */ }
  }
  const status = result === 'limited' ? 429 : 502;
  return Response.json(createProblem(status, result === 'limited' ? '잠시 후 다시 시도해 주세요.' : '요청 제한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', path), {
    status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) },
  });
}
