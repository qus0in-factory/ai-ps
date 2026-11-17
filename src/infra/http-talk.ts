import type { Result } from '../domain/chat.ts';
import type { TalkClient } from '../domain/talk/types.ts';
import { isTutorReply, record, only, text, LIMITS } from '../domain/talk/session.ts';

export function createHttpTalk(fetcher: typeof fetch = fetch): TalkClient {
  async function send<T>(path: string, body: unknown, valid: (value: unknown) => value is T, external?: AbortSignal): Promise<Result<T>> {
    const timeout = AbortSignal.timeout(75_000);
    const signal = external ? AbortSignal.any([external, timeout]) : timeout;
    const cancelled = () => ({ ok: false as const, reason: '요청이 중단되었거나 시간이 초과되었습니다.' });
    if (signal.aborted) return cancelled();
    let cancel: (() => void) | undefined;
    try {
      const aborted = new Promise<ReturnType<typeof cancelled>>(resolve => {
        cancel = () => resolve(cancelled()); signal.addEventListener('abort', cancel, { once: true });
      });
      const response = (async (): Promise<Result<T>> => {
        const result = await fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal });
        if (!result.ok) {
          const problem: unknown = await result.json().catch(() => null);
          return { ok: false, reason: record(problem) && text(problem.detail, 500) ? problem.detail : '회화 요청을 처리하지 못했습니다.' };
        }
        const value: unknown = await result.json();
        return valid(value) ? { ok: true, value } : { ok: false, reason: '올바른 회화 응답을 받지 못했습니다.' };
      })();
      const result = await Promise.race([response, aborted]);
      return signal.aborted ? cancelled() : result;
    } catch { return signal.aborted ? cancelled() : { ok: false, reason: '회화 서버에 연결하지 못했습니다. 다시 시도해 주세요.' }; }
    finally { if (cancel) signal.removeEventListener('abort', cancel); }
  }
  return {
    respond: (session, learner, signal) => send('/api/talk/turn', { session, ...(learner === undefined ? {} : { text: learner }) }, isTutorReply, signal),
    async report(session, signal) {
      const result = await send('/api/talk/report', { session }, (value): value is { report: string } => record(value) && only(value, ['report']) && text(value.report, LIMITS.report), signal);
      return result.ok ? { ok: true, value: result.value.report } : result;
    },
  };
}
