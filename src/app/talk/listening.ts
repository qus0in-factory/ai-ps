import type { AudioPlayer, SpeechClient } from '../../domain/talk/listening.ts';
import { isSpeakable } from '../../domain/talk/listening.ts';
export const canListen = isSpeakable;
export interface ListeningView { text: string; status: 'idle' | 'loading' | 'playing'; error: string }
export const initialListeningView = (): ListeningView => ({ text: '', status: 'idle', error: '' });
export function createListeningController(client: SpeechClient, player: AudioPlayer, onChange: (view: ListeningView) => void) {
  const urls = new Map<string, string>();
  let view = initialListeningView(), request: AbortController | undefined, generation = 0, disposed = false;
  const publish = (next: ListeningView) => { view = next; if (!disposed) onChange(next); };
  const stop = () => { generation++; request?.abort(); request = undefined; player.stop(); publish({ ...view, status: 'idle', error: '' }); };
  const clear = () => { stop(); for (const url of urls.values()) player.revokeUrl(url); urls.clear(); publish(initialListeningView()); };
  return {
    async toggle(text: string): Promise<void> {
      if (disposed || !canListen(text)) return;
      if (view.text === text && view.status !== 'idle') { stop(); return; }
      stop(); const current = generation;
      const caller = new AbortController(); request = caller;
      publish({ text, status: 'loading', error: '' });
      let abort!: () => void;
      const aborted = new Promise<{ ok: false; reason: string }>(resolve => { abort = () => resolve({ ok: false, reason: '중단했어요.' }); caller.signal.addEventListener('abort', abort, { once: true }); });
      try {
        let url = urls.get(text);
        if (!url) {
          const result = await Promise.race([client.speak(text, caller.signal), aborted]);
          if (current !== generation || disposed) return;
          if (!result.ok) { publish({ text, status: 'idle', error: result.reason }); return; }
          url = player.createUrl(result.value); urls.set(text, url);
        }
        let completed = false;
        const result = await Promise.race([player.play(url,
          () => { completed = true; if (current === generation) publish({ text, status: 'idle', error: '' }); },
          () => { completed = true; if (current === generation) publish({ text, status: 'idle', error: '음성을 재생하지 못했어요. 듣기를 다시 눌러주세요.' }); }), aborted]);
        if (current !== generation || disposed || completed) return;
        publish({ text, status: result.ok ? 'playing' : 'idle', error: result.ok ? '' : result.reason });
      } catch {
        if (current === generation && !disposed) { player.stop(); publish({ text, status: 'idle', error: '음성을 준비하지 못했어요. 잠시 후 다시 눌러주세요.' }); }
      } finally { caller.signal.removeEventListener('abort', abort); if (current === generation) request = undefined; }
    },
    stop, clear,
    dispose() { clear(); disposed = true; },
  };
}
export type ListeningController = ReturnType<typeof createListeningController>;
