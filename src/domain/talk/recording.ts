import type { Result } from '../chat.ts';
export interface Recorder {
  readonly supported: boolean;
  start(onComplete: (result: Result<Blob>) => void, onElapsed?: (seconds: number) => void): Promise<Result<void>>;
  stop(): Promise<Result<Blob>>;
  cancel(): void;
}
