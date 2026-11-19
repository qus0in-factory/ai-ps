import type { AudioCache } from '../domain/talk/speech-cache.ts';
import { createConsoleLogger } from './console-logger.ts';

const defaultWarn = createConsoleLogger().warn;

/** Structural subset of the Workers binding; no SDK runtime is needed. */
export interface R2Bucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: ArrayBuffer, options: {
    httpMetadata: { contentType: string };
    customMetadata: Record<string, string>;
  }): Promise<unknown>;
}

let warnedMissingBinding = false;

export function createR2AudioCache(bucket?: R2Bucket, options: {
  warn?: (entry: { event: 'tts_cache_unbound' }) => void;
} = {}): AudioCache {
  return {
    async get(key) {
      if (!bucket) {
        if (!warnedMissingBinding) {
          warnedMissingBinding = true;
          try { (options.warn ?? defaultWarn)({ event: 'tts_cache_unbound' }); } catch { /* Best-effort warning. */ }
        }
        return { ok: true, value: null };
      }
      try {
        const object = await bucket.get(key);
        return { ok: true, value: object ? { bytes: new Uint8Array(await object.arrayBuffer()), mimeType: 'audio/wav' } : null };
      } catch { return { ok: false, reason: '음성 캐시를 읽지 못했습니다.' }; }
    },
    async put(key, audio, metadata) {
      if (!bucket) return { ok: true, value: undefined };
      try {
        await bucket.put(key, Uint8Array.from(audio.bytes).buffer, {
          httpMetadata: { contentType: 'audio/wav' },
          customMetadata: { model: metadata.model, voice: metadata.voice },
        });
        return { ok: true, value: undefined };
      } catch { return { ok: false, reason: '음성 캐시를 저장하지 못했습니다.' }; }
    },
  };
}
