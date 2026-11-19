import type { UsageService, UsageStats } from '../domain/usage.ts';
import type { UsageDatabase } from './usage-recorder.ts';

const DAY_MS = 86_400_000;
const SERVICES = `'openai', 'brave', 'ncp'`;
const WINDOW = `ts >= ? AND ts <= ? AND service IN (${SERVICES})`;
const ERRORS = 'COALESCE(SUM(CASE WHEN status = 0 OR status >= 400 THEN 1 ELSE 0 END), 0)';
const TOTALS = `SELECT COUNT(*) AS calls, ${ERRORS} AS errors, COALESCE(SUM(cost_usd), 0) AS costUsd FROM usage_events WHERE ${WINDOW}`;
const BY_SERVICE = `SELECT service, COUNT(*) AS calls, ${ERRORS} AS errors, COALESCE(AVG(ms), 0) AS avgMs, COALESCE(SUM(cost_usd), 0) AS costUsd FROM usage_events WHERE ${WINDOW} GROUP BY service ORDER BY service`;
const BY_DAY = `SELECT date(ts / 1000, 'unixepoch') AS day, service, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS costUsd FROM usage_events WHERE ${WINDOW} GROUP BY date(ts / 1000, 'unixepoch'), service ORDER BY day, service`;

function empty(days: number): UsageStats {
  return { days, totals: { calls: 0, errors: 0, costUsd: 0 }, byService: [], byDay: [] };
}

function num(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function serviceOf(value: unknown): UsageService | undefined {
  return value === 'openai' || value === 'brave' || value === 'ncp' ? value : undefined;
}

function rowsOf(entry: unknown): Record<string, unknown>[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('usage stats batch');
  const result = entry as { success?: unknown; results?: unknown };
  if (result.success === false || !Array.isArray(result.results)) throw new Error('usage stats batch');
  return result.results.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
}

/** days는 오늘 UTC 날짜를 포함한 최근 N일이다. */
export async function queryUsageStats(db: UsageDatabase | undefined, input: { days: number; now: number }): Promise<UsageStats> {
  if (!db) return empty(input.days);
  const today = Math.floor(input.now / DAY_MS) * DAY_MS;
  const start = today - (input.days - 1) * DAY_MS;
  const batched: unknown = await db.batch([
    db.prepare(TOTALS).bind(start, input.now),
    db.prepare(BY_SERVICE).bind(start, input.now),
    db.prepare(BY_DAY).bind(start, input.now),
  ]);
  if (!Array.isArray(batched)) throw new Error('usage stats batch');
  const [totalRows, serviceRows, dayRows] = batched.map(rowsOf);
  const total = totalRows[0];
  const byService: UsageStats['byService'] = [];
  for (const row of serviceRows ?? []) {
    const service = serviceOf(row.service);
    if (!service) continue;
    byService.push({ service, calls: num(row.calls), errors: num(row.errors), avgMs: num(row.avgMs), costUsd: num(row.costUsd) });
  }
  const byDay: UsageStats['byDay'] = [];
  for (const row of dayRows ?? []) {
    const service = serviceOf(row.service);
    if (!service || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) continue;
    byDay.push({ day: row.day, service, calls: num(row.calls), costUsd: num(row.costUsd) });
  }
  return {
    days: input.days,
    totals: { calls: num(total?.calls), errors: num(total?.errors), costUsd: num(total?.costUsd) },
    byService,
    byDay,
  };
}
