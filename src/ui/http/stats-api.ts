import { Hono } from 'hono';
import type { UsageStats } from '../../domain/usage.ts';

export interface StatsApiDependencies {
  load(days: number, now: number): Promise<UsageStats>;
  now?: () => number;
}

function error(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function requestedDays(raw: string | undefined): number | undefined {
  if (raw === undefined) return 7;
  return /^(?:[1-9]|[12]\d|30)$/.test(raw) ? Number(raw) : undefined;
}

export function createStatsApi(deps: StatsApiDependencies) {
  const api = new Hono();
  api.get('/api/stats', async c => {
    const days = requestedDays(c.req.query('days'));
    if (days === undefined) return error(400, 'days는 1에서 30 사이의 정수여야 합니다.');
    try {
      const stats = await deps.load(days, (deps.now ?? Date.now)());
      return Response.json(stats, { headers: { 'Cache-Control': 'max-age=60' } });
    } catch {
      return error(502, '일시적으로 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  });
  api.all('/api/stats', () => error(405, 'GET 요청만 가능합니다.', { Allow: 'GET' }));
  return api;
}
