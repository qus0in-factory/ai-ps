import type { Result } from '../domain/chat.ts';
import type { Recorder } from '../domain/talk/recording.ts';
interface Stream { getTracks(): { stop(): void }[] }
interface Capture {
  state: string; mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null; onerror: (() => void) | null;
  start(timeslice?: number): void; stop(): void;
}
export interface RecorderEnvironment {
  getUserMedia(): Promise<Stream>;
  isTypeSupported(mime: string): boolean;
  createRecorder(stream: Stream, mime: string): Capture;
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
}
function browserEnvironment(): RecorderEnvironment | undefined {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return;
  return { getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    isTypeSupported: mime => MediaRecorder.isTypeSupported(mime),
    createRecorder: (stream, mimeType) => {
      const native = new MediaRecorder(stream as MediaStream, { mimeType });
      const capture: Capture = {
        get state() { return native.state; }, get mimeType() { return native.mimeType; },
        ondataavailable: null, onstop: null, onerror: null,
        start: timeslice => native.start(timeslice), stop: () => native.stop(),
      };
      native.ondataavailable = event => capture.ondataavailable?.(event);
      native.onstop = () => capture.onstop?.(); native.onerror = () => capture.onerror?.();
      return capture;
    },
    now: () => performance.now(), schedule: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } };
}
const failure = (reason: string): Result<never> => ({ ok: false, reason });
export function createBrowserRecorder(env = browserEnvironment()): Recorder {
  const mime = ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/wav'].find(type => {
    try { return env?.isTypeSupported(type); } catch { return false; }
  });
  let active: { finish(result: Result<Blob>): void; stop(): void; result: Promise<Result<Blob>> } | undefined;
  return {
    supported: !!mime,
    async start(onComplete, onElapsed) {
      if (!env || !mime) return failure('이 브라우저에서는 녹음을 지원하지 않아요. 텍스트로 입력해 주세요.');
      if (active) return failure('이미 녹음 중이에요. 먼저 녹음을 마쳐주세요.');
      let stream: Stream | undefined, capture: Capture | undefined, settled = false, released = false, stopping = false;
      let started = 0, size = 0; const chunks: Blob[] = [], timers: (() => void)[] = [];
      let resolve!: (result: Result<Blob>) => void;
      const result = new Promise<Result<Blob>>(r => { resolve = r; });
      const release = () => { if (stream && !released) { released = true; for (const track of stream.getTracks()) track.stop(); } };
      const task = {
        result,
        finish(value: Result<Blob>) {
          if (settled) return; settled = true;
          for (const cancel of timers) cancel();
          if (capture) { capture.ondataavailable = null; capture.onstop = null; capture.onerror = null;
            try { if (capture.state !== 'inactive') capture.stop(); } catch { /* release tracks below */ } }
          release(); if (active === task) active = undefined;
          resolve(value); onComplete(value);
        },
        stop() {
          if (settled || stopping || !capture) return; stopping = true;
          // Keep tracks alive until the final dataavailable/onstop (notably Safari MP4).
          try { capture.stop(); }
          catch { task.finish(failure('녹음을 마치지 못했어요. 텍스트로 입력하거나 다시 시도해 주세요.')); }
          if (!settled) timers.push(env.schedule(() => task.finish(failure('녹음 파일을 받지 못했어요. 다시 시도해 주세요.')), 1500));
        },
      };
      active = task;
      try {
        stream = await env.getUserMedia();
        if (settled) { release(); return failure('녹음을 취소했어요.'); }
        capture = env.createRecorder(stream, mime);
        capture.ondataavailable = event => {
          if (settled || !event.data.size) return;
          size += event.data.size;
          if (size > 2 * 1024 * 1024) { task.finish(failure('녹음 파일이 2 MB를 넘었어요. 더 짧게 녹음해 주세요.')); return; }
          chunks.push(event.data);
        };
        capture.onstop = () => {
          const blob = new Blob(chunks, { type: capture?.mimeType || mime });
          task.finish(env.now() - started < 500 ? failure('조금 더 길게 말해 주세요. 0.5초 이상 녹음할 수 있어요.') : blob.size ? { ok: true, value: blob } : failure('녹음된 소리가 없어요. 다시 시도해 주세요.'));
        };
        capture.onerror = () => task.finish(failure('마이크 녹음에 실패했어요. 텍스트로 입력하거나 다시 시도해 주세요.'));
        started = env.now(); capture.start(250); onElapsed?.(0);
        timers.push(env.schedule(() => task.stop(), 30_000));
        const tick = () => { if (settled || stopping) return; onElapsed?.(Math.min(30, Math.floor((env.now() - started) / 1000))); timers.push(env.schedule(tick, 1000)); };
        timers.push(env.schedule(tick, 1000));
        return { ok: true, value: undefined };
      } catch {
        const value = failure('마이크를 사용할 수 없어요. 브라우저 권한을 확인하거나 텍스트로 입력해 주세요.');
        task.finish(value); return value;
      }
    },
    stop() { const task = active; if (!task) return Promise.resolve(failure('진행 중인 녹음이 없어요.')); task.stop(); return task.result; },
    cancel() { active?.finish(failure('녹음을 취소했어요. 입력한 내용은 그대로예요.')); },
  };
}
