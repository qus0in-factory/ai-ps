import type { TutorReply } from './types.ts';
import { LIMITS, record } from './session.ts';
export const FALLBACK_REPLY = 'もう一度言ってもらえますか？';
const fallback = (): TutorReply => ({ reply: FALLBACK_REPLY, correction: null, betterExpression: null });
const bounded = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max).trim() || null : null;
export function parseTutorReply(content: string): TutorReply {
  if (typeof content !== 'string' || content.length > 16_000) return fallback();
  let value: unknown;
  try { value = JSON.parse(content); }
  catch {
    try { value = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)); }
    catch { return fallback(); }
  }
  if (!record(value)) return fallback();
  const reply = bounded(value.reply, LIMITS.reply);
  const correction = bounded(value.correction, LIMITS.correction);
  // If the provider ignores the explanation language, withhold feedback rather than mislabel it.
  return reply ? { reply, correction: correction && /[가-힣]/u.test(correction) ? correction : null, betterExpression: bounded(value.betterExpression, LIMITS.correction) } : fallback();
}
