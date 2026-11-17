import type { AudioPlayer } from '../domain/talk/listening.ts';
interface AudioElement {
  play(): Promise<void>; pause(): void; load(): void; removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
interface AudioEnvironment { createAudio(url: string): AudioElement; createUrl(blob: Blob): string; revokeUrl(url: string): void }
export function createBrowserAudioPlayer(env: AudioEnvironment = {
  createAudio: url => new Audio(url), createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
}): AudioPlayer {
  let active: { audio: AudioElement; cleanup(): void } | undefined;
  const stop = () => {
    const previous = active; active = undefined;
    if (!previous) return;
    previous.cleanup(); previous.audio.pause(); previous.audio.removeAttribute('src'); previous.audio.load();
  };
  return {
    createUrl: blob => env.createUrl(blob), revokeUrl: url => env.revokeUrl(url), stop,
    async play(url, onEnded, onError) {
      stop();
      let current: typeof active;
      try {
        const audio = env.createAudio(url);
        const ended = () => { if (active === current) { stop(); onEnded(); } };
        const failed = () => { if (active === current) { stop(); onError(); } };
        current = { audio, cleanup: () => { audio.removeEventListener('ended', ended); audio.removeEventListener('error', failed); } };
        active = current; audio.addEventListener('ended', ended); audio.addEventListener('error', failed);
        await audio.play();
        if (active !== current) return { ok: false, reason: '음성 재생을 중단했어요.' };
        return { ok: true, value: undefined };
      } catch {
        if (active === current) stop();
        return { ok: false, reason: '재생을 시작하지 못했어요. 듣기를 다시 눌러주세요.' };
      }
    },
  };
}
