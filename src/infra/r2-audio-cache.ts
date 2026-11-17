import type { AudioCache } from '../domain/talk/speech-cache.ts';

/** Structural subset of the Workers binding; no SDK runtime is needed. */
export interface R2Bucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: ArrayBuffer, options: {
    httpMetadata: { contentType: string };
    customMetadata: Record<string, string>;
  }): Promise<unknown>;
}

export function createR2AudioCache(bucket: R2Bucket): AudioCache {
  return {
    async get(key) {
      try {
        const object = await bucket.get(key);
        return { ok: true, value: object ? { bytes: new Uint8Array(await object.arrayBuffer()), mimeType: 'audio/wav' } : null };
      } catch { return { ok: false, reason: '음성 캐시를 읽지 못했습니다.' }; }
    },
    async put(key, audio, metadata) {
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
