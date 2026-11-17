import type { Result } from '../domain/chat.ts';
import { isSpeakable } from '../domain/talk/listening.ts';
import type { TalkClient } from '../domain/talk/types.ts';
import { isTutorReply, record, only, text, LIMITS } from '../domain/talk/session.ts';

export function createHttpTalk(fetcher: typeof fetch = fetch): TalkClient {
  async function send<T>(path: string, body: unknown, valid: (value: unknown) => value is T, external?: AbortSignal, timeoutMs = 75_000): Promise<Result<T>> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = external ? AbortSignal.any([external, timeout]) : timeout;
    const cancelled = () => ({ ok: false as const, reason: '요청이 중단되었거나 시간이 초과되었습니다.' });
    if (signal.aborted) return cancelled();
    let cancel: (() => void) | undefined;
    try {
      const aborted = new Promise<ReturnType<typeof cancelled>>(resolve => {
        cancel = () => resolve(cancelled()); signal.addEventListener('abort', cancel, { once: true });
      });
      const response = (async (): Promise<Result<T>> => {
        const result = await fetcher(path, { method: 'POST', headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Accept: 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body), signal });
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
    async speak(words, external) {
      if (!isSpeakable(words)) return { ok: false, reason: '듣기는 1~400자 문장만 가능해요.' };
      const timeout = AbortSignal.timeout(45_000);
      const signal = external ? AbortSignal.any([external, timeout]) : timeout;
      const cancelled = { ok: false as const, reason: '음성 요청을 중단했거나 시간이 초과됐어요.' };
      if (signal.aborted) return cancelled;
      let abort!: () => void;
      const aborted = new Promise<typeof cancelled>(resolve => { abort = () => resolve(cancelled); signal.addEventListener('abort', abort, { once: true }); });
      try {
        const response = (async (): Promise<Result<Blob>> => {
          const result = await fetcher('/api/talk/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' }, body: JSON.stringify({ text: words }), signal });
          if (!result.ok) {
            const problem: unknown = await result.json().catch(() => null);
            return { ok: false, reason: record(problem) && text(problem.detail, 500) ? problem.detail : '음성을 가져오지 못했어요. 다시 눌러주세요.' };
          }
          if (result.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'audio/wav') return { ok: false, reason: '올바른 음성 파일을 받지 못했어요.' };
          const blob = await result.blob();
          if (blob.size < 44 || blob.size > 2 * 1024 * 1024) return { ok: false, reason: '올바른 음성 파일을 받지 못했어요.' };
          const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
          if (String.fromCharCode(...header.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') return { ok: false, reason: '올바른 음성 파일을 받지 못했어요.' };
          return { ok: true, value: blob };
        })();
        const result = await Promise.race([response, aborted]);
        return signal.aborted ? cancelled : result;
      } catch { return signal.aborted ? cancelled : { ok: false, reason: '음성 서버에 연결하지 못했어요. 다시 눌러주세요.' }; }
      finally { signal.removeEventListener('abort', abort); }
    },
    async transcribe(audio, signal) {
      const mime = audio.type.split(';')[0]!.trim().toLowerCase();
      const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
      if (!audio.size || audio.size > 2 * 1024 * 1024 || !extensions[mime]) return { ok: false, reason: '2 MB 이하의 녹음 파일이 필요해요.' };
      const body = new FormData(); body.append('audio', audio, `speech.${extensions[mime]}`);
      const result = await send('/api/talk/transcribe', body,
        (value): value is { text: string } => record(value) && only(value, ['text']) && typeof value.text === 'string' && value.text.length <= 5000, signal, 45_000);
      return result.ok ? { ok: true, value: result.value.text } : result;
    },
    respond: (session, learner, signal) => send('/api/talk/turn', { session, ...(learner === undefined ? {} : { text: learner }) }, isTutorReply, signal),
    async report(session, signal) {
      const result = await send('/api/talk/report', { session }, (value): value is { report: string } => record(value) && only(value, ['report']) && text(value.report, LIMITS.report), signal);
      return result.ok ? { ok: true, value: result.value.report } : result;
    },
  };
}
