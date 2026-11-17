import type { AdventureClient, AdventureListener, AdventureSession } from '../domain/adventure/types.ts';
import type { Result } from '../domain/chat.ts';
import { isAdventureSession, isAdventureEvent, record } from '../domain/adventure/session.ts';
import { readJsonLines } from './json-lines.ts';
export function createHttpAdventure(fetcher: typeof fetch = fetch, timeoutMs = 120_000): AdventureClient {
  async function send(path: string, body: unknown, onEvent?: AdventureListener, externalSignal?: AbortSignal): Promise<Result<AdventureSession>> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
    try {
      const response = await fetcher(path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(body) });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        return { ok: false, reason: typeof problem?.detail === 'string' ? problem.detail : `모험 요청 실패 (HTTP ${response.status})` };
      }
      for await (const frame of readJsonLines(response, signal)) {
        if (!record(frame)) throw new Error('Invalid frame');
        if (frame.type === 'event' && isAdventureEvent(frame.event)) onEvent?.(frame.event);
        else if (frame.type === 'problem' && record(frame.problem)) return { ok: false, reason: typeof frame.problem.detail === 'string' ? frame.problem.detail : '모험 요청에 실패했습니다.' };
        else if (frame.type === 'result' && isAdventureSession(frame.value)) return { ok: true, value: frame.value };
        else throw new Error('Invalid frame');
      }
      return { ok: false, reason: '결과를 받기 전에 연결이 종료되었습니다.' };
    } catch { return { ok: false, reason: signal.aborted ? '모험 요청이 중단되었거나 시간이 초과되었습니다.' : '모험 응답을 읽지 못했습니다.' }; }
  }
  return { start: (onEvent, signal) => send('/api/adventure/start', {}, onEvent, signal), turn: (session, action, onEvent, signal) => send('/api/adventure/turn', { session, action }, onEvent, signal) };
}
