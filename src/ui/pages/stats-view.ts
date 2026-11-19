import type { Result } from '../../domain/chat.ts';
import type { UsageService, UsageStats } from '../../domain/usage.ts';

export interface StatsClient {
  get(days?: number): Promise<Result<UsageStats>>;
}

const LABELS: Record<UsageService, string> = { openai: 'OpenAI', brave: 'Brave', ncp: 'NAVER' };

export function serviceLabel(service: UsageService): string {
  return LABELS[service];
}

export function errorRate(calls: number, errors: number): string {
  return calls === 0 ? '0%' : `${Number(((errors / calls) * 100).toFixed(1))}%`;
}

/** 캐시 적中률: 입력 토큰 중 프롬프트 캐시가 적중한 비율(§16). */
export function cacheHitRate(inputTokens: number, cachedTokens: number): string {
  return inputTokens === 0 ? '0%' : `${Number(((cachedTokens / inputTokens) * 100).toFixed(1))}%`;
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  return value < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function formatMs(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

// 서버는 데이터 없는 날을 생략하므로, 조회 기간의 모든 UTC 날짜를 0으로 채워 서비스별 비용을 합친다.
export function dailyCosts(stats: UsageStats, now: Date): { day: string; costUsd: number }[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sums = new Map<string, number>();
  for (const row of stats.byDay) sums.set(row.day, (sums.get(row.day) ?? 0) + row.costUsd);
  return Array.from({ length: stats.days }, (_, index) => {
    const day = new Date(end - (stats.days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
    return { day, costUsd: sums.get(day) ?? 0 };
  });
}
