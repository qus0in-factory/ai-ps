import type { TalkSession, TutorReply } from './types.ts';

export const LIMITS = { turns: 40, learner: 500, reply: 600, correction: 300, report: 1500, bodyBytes: 64_000 } as const;
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
export const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
export function isTutorReply(value: unknown): value is TutorReply {
  return record(value) && only(value, ['reply','correction','betterExpression']) && text(value.reply, LIMITS.reply) &&
    [value.correction, value.betterExpression].every(v => v === null || text(v, LIMITS.correction));
}
export function isTalkSession(value: unknown): value is TalkSession {
  return record(value) && only(value, ['version','turns']) && value.version === 1 && Array.isArray(value.turns) && value.turns.length <= LIMITS.turns &&
    value.turns.every((turn, index) => record(turn) && only(turn, ['learner','tutor']) &&
      ((index === 0 && turn.learner === '') || text(turn.learner, LIMITS.learner)) && isTutorReply(turn.tutor));
}
export function createSession(): TalkSession { return { version: 1, turns: [] }; }
export function normalizeSession(value: unknown): TalkSession | undefined {
  if (!isTalkSession(value)) return undefined;
  return { version: 1, turns: value.turns.map(({ learner, tutor }) => ({ learner, tutor: { reply: tutor.reply, correction: tutor.correction, betterExpression: tutor.betterExpression } })) };
}
export function canAddTurn(session: TalkSession, learner?: string): boolean {
  if (session.turns.length >= LIMITS.turns) return false;
  if (learner === undefined ? session.turns.length !== 0 : !text(learner.trim(), LIMITS.learner)) return false;
  // Reserve even JSON-escaped output so the completed session can still be sent for a report.
  const tutor = { reply: '\u0000'.repeat(LIMITS.reply), correction: '\u0000'.repeat(LIMITS.correction), betterExpression: '\u0000'.repeat(LIMITS.correction) };
  const next = { version: 1, turns: [...session.turns, { learner: learner?.trim() ?? '', tutor }] };
  return new TextEncoder().encode(JSON.stringify({ session: next })).length <= LIMITS.bodyBytes;
}
