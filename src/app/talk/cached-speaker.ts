import { createSpeechCacheKey, type AudioCache, type CachedSpeaker, type Speaker, type SpeechCacheIdentity, type SpeechCacheWarning } from '../../domain/talk/speech-cache.ts';

export function createCachedSpeaker(speaker: Speaker, cache: AudioCache, options: SpeechCacheIdentity & {
  warn: (entry: SpeechCacheWarning) => void;
}): CachedSpeaker {
  const warnPut = (key: string) => {
    try { options.warn({ event: 'tts_cache_put_failed', key }); }
    catch { /* A logger failure must not discard already generated audio. */ }
  };
  const cancelled = () => ({ ok: false as const, reason: '음성 요청이 중단되었습니다.' });
  return {
    async speak(text, signal) {
      if (signal?.aborted) return cancelled();
      const prepared = await createSpeechCacheKey(text, options);
      if (!prepared.ok) return prepared;
      if (signal?.aborted) return cancelled();
      const { key, text: normalized } = prepared.value;
      // A failed read is not a miss: avoid an accidental paid synthesis during an outage.
      let stored;
      try { stored = await cache.get(key); }
      catch { return { ok: false, reason: '음성 캐시를 읽지 못했습니다.' }; }
      if (signal?.aborted) return cancelled();
      if (!stored.ok) return stored;
      if (stored.value) return { ok: true, value: { ...stored.value, cache: 'hit' } };

      const generated = await speaker.speak(normalized, signal);
      if (!generated.ok) return generated;
      try {
        const saved = await cache.put(key, generated.value, { model: options.model, voice: options.voice });
        if (!saved.ok) warnPut(key);
      } catch { warnPut(key); }
      return { ok: true, value: { ...generated.value, cache: 'miss' } };
    },
  };
}
