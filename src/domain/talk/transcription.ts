import type { Result } from '../chat.ts';

export interface Transcriber {
  transcribe(audio: Blob, signal?: AbortSignal): Promise<Result<string>>;
}
