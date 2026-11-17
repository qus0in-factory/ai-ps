import type { Result } from '../chat.ts';

export interface TutorReply { reply: string; correction: string | null; betterExpression: string | null }
export interface TalkTurn { learner: string; tutor: TutorReply }
export interface TalkSession { version: 1; turns: TalkTurn[] }
export type TalkPhase = 'idle' | 'thinking' | 'reporting' | 'ended';
export interface Tutor {
  respond(session: TalkSession, text?: string, signal?: AbortSignal): Promise<Result<TutorReply>>;
}
export interface Reporter {
  report(session: TalkSession, signal?: AbortSignal): Promise<Result<string>>;
}
/** Stage 1 is text-only. Audio ports are introduced with their implementations later. */
export interface TalkClient extends Tutor, Reporter {}
