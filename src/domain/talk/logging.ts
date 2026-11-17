export interface TalkLogEntry {
  event: 'turn' | 'report' | 'transcribe';
  ok: boolean;
  ms: number;
  turns?: number;
  learnerChars?: number;
  replyChars?: number;
  reportChars?: number;
  inputBytes?: number;
  outputChars?: number;
}

export type TalkLogListener = (entry: TalkLogEntry) => void;
