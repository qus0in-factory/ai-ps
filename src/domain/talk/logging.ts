export interface TalkRequestLogEntry {
  event: 'turn' | 'report' | 'transcribe' | 'speech';
  ok: boolean;
  ms: number;
  turns?: number;
  learnerChars?: number;
  replyChars?: number;
  reportChars?: number;
  inputBytes?: number;
  outputChars?: number;
  cache?: 'hit' | 'miss';
  inputChars?: number;
  outputBytes?: number;
}

export type TalkLogEntry = TalkRequestLogEntry | { event: 'rate_limited'; path: string; ok: false };

export type TalkLogListener = (entry: TalkLogEntry) => void;
