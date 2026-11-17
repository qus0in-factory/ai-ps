import type { TalkLogEntry, TalkLogListener } from '../domain/talk/logging.ts';

export function createTalkLogger(logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }): TalkLogListener {
  return entry => {
    const level = entry.ok ? 'info' : 'warn';
    logger[level]({ component: 'talk', event: entry.event, ok: entry.ok, ms: entry.ms,
      ...(entry.turns === undefined ? {} : { turns: entry.turns }),
      ...(entry.learnerChars === undefined ? {} : { learnerChars: entry.learnerChars }),
      ...(entry.replyChars === undefined ? {} : { replyChars: entry.replyChars }),
      ...(entry.reportChars === undefined ? {} : { reportChars: entry.reportChars }),
      ...(entry.inputBytes === undefined ? {} : { inputBytes: entry.inputBytes }),
      ...(entry.outputChars === undefined ? {} : { outputChars: entry.outputChars }),
    }, 'Talk 진행');
  };
}
