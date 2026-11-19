import type { Result } from '../domain/chat.ts';
import type { UsageService, UsageStats } from '../domain/usage.ts';

const SERVICES: readonly string[] = ['openai', 'brave', 'ncp'];
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const TIMEOUT_MS = 10_000;
const ROWS_MAX = 1_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function service(value: unknown): value is UsageService {
  return typeof value === 'string' && SERVICES.includes(value);
}

function isStats(value: unknown): value is UsageStats {
  if (!record(value) || !num(value.days) || !record(value.totals)) return false;
  const { totals, byService, byDay } = value;
  if (!num(totals.calls) || !num(totals.errors) || !num(totals.costUsd)) return false;
  if (!Array.isArray(byService) || byService.length > ROWS_MAX || !Array.isArray(byDay) || byDay.length > ROWS_MAX) return false;
  return byService.every((row) => record(row) && service(row.service) && num(row.calls) && num(row.errors) && num(row.avgMs) && num(row.costUsd))
    && byDay.every((row) => record(row) && typeof row.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.day)
      && service(row.service) && num(row.calls) && num(row.costUsd));
}

export function createHttpStats(fetcher: typeof fetch = fetch) {
  return {
    async get(days = DEFAULT_DAYS): Promise<Result<UsageStats>> {
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
        return { ok: false, reason: `조회 기간은 1~${MAX_DAYS}일로 입력해 주세요.` };
      }
      try {
        const response = await fetcher(`/api/stats?days=${days}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return { ok: false, reason: '사용량 통계를 불러오지 못했습니다.' };
        const value: unknown = await response.json().catch(() => null);
        return isStats(value) ? { ok: true, value } : { ok: false, reason: '올바른 사용량 통계를 받지 못했습니다.' };
      } catch {
        return { ok: false, reason: '서버에 연결하지 못했습니다. 다시 시도해 주세요.' };
      }
    },
  };
}
