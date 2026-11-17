import type { SpeechClient } from './listening.ts';
import type { Transcriber } from './transcription.ts';
import type { Result } from '../chat.ts';

export type TutorGender = 'f' | 'm';
export type TutorMood = 'neutral' | 'smile' | 'think' | 'surprised' | 'encourage' | 'confused';
export interface TutorReply { mood: TutorMood; reply: string; correction: string | null; betterExpression: string | null }
export interface TalkTurn { learner: string; tutor: TutorReply }
export interface TalkSession { version: 1; tutor: TutorGender; turns: TalkTurn[] }
export type TalkPhase = 'idle' | 'requesting-microphone' | 'recording' | 'transcribing' | 'thinking' | 'reporting' | 'ended';
export interface Tutor {
  respond(session: TalkSession, text?: string, signal?: AbortSignal): Promise<Result<TutorReply>>;
}
export interface Reporter {
  report(session: TalkSession, signal?: AbortSignal): Promise<Result<string>>;
}
export interface TalkClient extends Tutor, Reporter, Transcriber, SpeechClient {}
