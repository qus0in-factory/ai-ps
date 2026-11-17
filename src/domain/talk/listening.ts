import type { Result } from '../chat.ts';
import { MAX_TTS_TEXT_LENGTH } from './speech-cache.ts';
export const isSpeakable = (text: string): boolean => typeof text === 'string' && !!text.trim() && [...text].length <= MAX_TTS_TEXT_LENGTH;
export interface SpeechClient { speak(text: string, signal?: AbortSignal): Promise<Result<Blob>> }
export interface AudioPlayer {
  createUrl(audio: Blob): string;
  revokeUrl(url: string): void;
  play(url: string, onEnded: () => void, onError: () => void): Promise<Result<void>>;
  stop(): void;
}
