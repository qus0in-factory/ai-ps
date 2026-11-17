import type { TalkSession, TutorReply, TutorGender, TutorMood } from './types.ts';

export const LIMITS = { turns: 40, learner: 500, reply: 600, correction: 300, report: 1500, bodyBytes: 64_000 } as const;
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
export const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;
export function isTutorGender(value: unknown): value is TutorGender { return value === 'f' || value === 'm'; }
export function isTutorMood(value: unknown): value is TutorMood { return ['neutral','smile','think','surprised','encourage','confused'].includes(value as string); }
export function isTutorReply(value: unknown): value is TutorReply {
  return record(value) && only(value, ['reply','correction','betterExpression','mood']) && isTutorMood(value.mood) && text(value.reply, LIMITS.reply) &&
    [value.correction, value.betterExpression].every(v => v === null || text(v, LIMITS.correction));
}
export function isTalkSession(value: unknown): value is TalkSession {
  return record(value) && only(value, ['version','turns','tutor']) && value.version === 1 && isTutorGender(value.tutor) && Array.isArray(value.turns) && value.turns.length <= LIMITS.turns &&
    value.turns.every((turn, index) => record(turn) && only(turn, ['learner','tutor']) &&
      ((index === 0 && turn.learner === '') || text(turn.learner, LIMITS.learner)) && isTutorReply(turn.tutor));
}
export function createSession(tutor: TutorGender = 'f'): TalkSession { return { version: 1, tutor, turns: [] }; }
export function normalizeSession(value: unknown): TalkSession | undefined {
  if (!record(value) || !Array.isArray(value.turns) || value.turns.length > LIMITS.turns) return undefined;
  // Version 1 records created before portraits remain readable; explicit invalid enums fail validation.
  const candidate = { ...value, tutor: value.tutor === undefined ? 'f' : value.tutor,
    turns: value.turns.map(turn => record(turn) && record(turn.tutor) ? {
      ...turn, tutor: { ...turn.tutor, mood: turn.tutor.mood === undefined ? 'neutral' : turn.tutor.mood },
    } : turn) };
  if (!isTalkSession(candidate)) return undefined;
  return { version: 1, tutor: candidate.tutor, turns: candidate.turns.map(({ learner, tutor }) => ({ learner, tutor: { reply: tutor.reply, correction: tutor.correction, betterExpression: tutor.betterExpression, mood: tutor.mood } })) };
}
export function canAddTurn(session: TalkSession, learner?: string): boolean {
  if (session.turns.length >= LIMITS.turns) return false;
  if (learner === undefined ? session.turns.length !== 0 : !text(learner.trim(), LIMITS.learner)) return false;
  // Reserve even JSON-escaped output so the completed session can still be sent for a report.
  const tutor = { mood: 'encourage', reply: '\u0000'.repeat(LIMITS.reply), correction: '\u0000'.repeat(LIMITS.correction), betterExpression: '\u0000'.repeat(LIMITS.correction) };
  const next = { version: 1, tutor: session.tutor, turns: [...session.turns, { learner: learner?.trim() ?? '', tutor }] };
  return new TextEncoder().encode(JSON.stringify({ session: next })).length <= LIMITS.bodyBytes;
}
