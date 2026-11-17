import type { Recorder } from '../../domain/talk/recording.ts';
import type { Transcriber } from '../../domain/talk/transcription.ts';
import type { Result } from '../../domain/chat.ts';
import { isBusy, atLimit, TALK_LIMITS, type TalkView } from './session-store.ts';
interface ViewStore { getState(): TalkView; setState(view: TalkView): void }
export function createRecordingController(recorder: Recorder, transcriber: Transcriber, store: ViewStore) {
  let active: AbortController | undefined;
  return {
    async record(): Promise<Result<void>> {
      const view = store.getState();
      if (active || isBusy(view) || !view.session || view.phase === 'ended' || atLimit(view)) return { ok: false, reason: '지금은 녹음을 시작할 수 없어요.' };
      if (!recorder.supported) { const reason = '이 브라우저에서는 녹음을 지원하지 않아요. 텍스트로 입력해 주세요.'; store.setState({ ...view, error: reason }); return { ok: false, reason }; }
      const caller = new AbortController(); active = caller;
      const cancelled = { ok: false as const, reason: '받아쓰기를 중단했어요. 입력한 내용은 그대로예요.' };
      let onAbort!: () => void;
      const aborted = new Promise<typeof cancelled>(resolve => { onAbort = () => resolve(cancelled); caller.signal.addEventListener('abort', onAbort, { once: true }); });
      store.setState({ ...view, phase: 'requesting-microphone', recordingSeconds: 0, error: '' });
      const fail = (reason: string): Result<void> => { store.setState({ ...store.getState(), phase: 'idle', error: reason }); return { ok: false, reason }; };
      try {
        let completed!: (value: Result<Blob>) => void;
        const audio = new Promise<Result<Blob>>(resolve => { completed = resolve; });
        const started = await Promise.race([recorder.start(completed, seconds => {
          if (!caller.signal.aborted) store.setState({ ...store.getState(), recordingSeconds: seconds });
        }), aborted]);
        if (!started.ok) return fail(started.reason);
        store.setState({ ...store.getState(), phase: 'recording' });
        const recorded = await Promise.race([audio, aborted]);
        if (caller.signal.aborted) return fail(cancelled.reason);
        if (!recorded.ok) return fail(recorded.reason);
        store.setState({ ...store.getState(), phase: 'transcribing' });
        const result = await Promise.race([transcriber.transcribe(recorded.value, caller.signal), aborted]);
        if (caller.signal.aborted) return fail(cancelled.reason);
        if (!result.ok) return fail(result.reason);
        const words = result.value.trim();
        if (!words) return fail('잘 못 알아들었어요. 다시 말하거나 텍스트로 입력해 주세요.');
        const current = store.getState();
        const learnerText = [current.learnerText.trimEnd(), words].filter(Boolean).join('\n');
        if (learnerText.length > TALK_LIMITS.learner) return fail('받아쓴 내용과 입력을 합치면 500자를 넘어요. 더 짧게 녹음하거나 텍스트로 입력해 주세요.');
        store.setState({ ...current, learnerText, phase: 'idle', error: '' });
        return { ok: true, value: undefined };
      } catch { return fail('녹음이나 받아쓰기를 마치지 못했어요. 텍스트로 입력하거나 다시 시도해 주세요.'); }
      finally { caller.signal.removeEventListener('abort', onAbort); recorder.cancel(); active = undefined; }
    },
    stop: () => { void recorder.stop(); },
    cancel: () => { active?.abort(); recorder.cancel(); },
  };
}
