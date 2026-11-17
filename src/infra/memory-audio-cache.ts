import type { AudioCache, AudioClip } from '../domain/talk/speech-cache.ts';

export function createMemoryAudioCache(): AudioCache {
  const entries = new Map<string, AudioClip>();
  return {
    async get(key) {
      const audio = entries.get(key);
      return { ok: true, value: audio ? { bytes: Uint8Array.from(audio.bytes), mimeType: audio.mimeType } : null };
    },
    async put(key, audio) {
      entries.set(key, { bytes: Uint8Array.from(audio.bytes), mimeType: audio.mimeType });
      return { ok: true, value: undefined };
    },
  };
}
