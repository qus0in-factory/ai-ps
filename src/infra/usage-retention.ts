import { USAGE_RETENTION_DAYS } from '../domain/usage.ts';
import type { UsageDatabase } from './usage-recorder.ts';

export type { UsageDatabase };

/** Drop usage_events rows whose ts (epoch ms) is older than the retention window. */
export const USAGE_RETENTION_MS = USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const DELETE_EXPIRED = 'DELETE FROM usage_events WHERE ts < ?';

/** Delete expired metric rows from the daily cron. No database means nothing to prune. */
export async function pruneUsageEvents(db: UsageDatabase | undefined, now: number): Promise<void> {
  if (!db) return;
  await db.batch([db.prepare(DELETE_EXPIRED).bind(now - USAGE_RETENTION_MS)]);
}
