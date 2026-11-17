import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedSpeaker } from '../../../src/app/talk/cached-speaker.ts';
import { createMemoryAudioCache } from '../../../src/infra/memory-audio-cache.ts';
import { createSpeechCacheKey, type AudioCache, type AudioClip, type Speaker } from '../../../src/domain/talk/speech-cache.ts';

const identity = { model: 'test-tts', voice: 'coral', promptVersion: 'ja-v1' };
const audio: AudioClip = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' };
const options = { ...identity, warn: (_entry: unknown) => {} };

describe('Given a cached speaker before the paid TTS provider', () => {
  it('When the normalized text is already cached Then returns its WAV with no speaker call', async () => {
    const cache = createMemoryAudioCache();
    const key = await createSpeechCacheKey('こんにちは 世界', identity);
    assert.ok(key.ok); if (!key.ok) return;
    await cache.put(key.value.key, audio, identity);
    const speaker = createCachedSpeaker({ speak: async () => { throw new Error('Must not call provider'); } }, cache, options);
    const result = await speaker.speak('　こんにちは　　世界\n');
    assert.deepEqual(result, { ok: true, value: { ...audio, cache: 'hit' } });
  });
  it('When a cache miss is synthesized Then puts the audio and the next equivalent request is a hit', async () => {
    let calls = 0, writtenKey = '';
    const memory = createMemoryAudioCache();
    const controller = new AbortController();
    const cache: AudioCache = { get: key => memory.get(key), put: async (key, value, metadata) => {
      writtenKey = key;
      assert.deepEqual(metadata, { model: identity.model, voice: identity.voice });
      return await memory.put(key, value, metadata);
    } };
    const speaker = createCachedSpeaker({ speak: async (text, signal) => {
      calls++; assert.equal(text, 'ガ こんにちは'); assert.equal(signal, controller.signal);
      return { ok: true, value: audio };
    } }, cache, options);
    assert.deepEqual(await speaker.speak('　カ\u3099　こんにちは ', controller.signal), { ok: true, value: { ...audio, cache: 'miss' } });
    assert.match(writtenKey, /^tts\/v1\/[a-f0-9]{64}\.wav$/);
    assert.equal((await speaker.speak('ガ こんにちは')).ok, true);
    assert.equal(calls, 1);
  });
  for (const failure of ['result', 'throw', 'logger-throw']) {
    it(`When cache put fails (${failure}) Then still returns audio and emits only safe warning metadata`, async () => {
      const warnings: unknown[] = [];
      const cache: AudioCache = { get: async () => ({ ok: true, value: null }), put: async () => {
        if (failure === 'throw') throw new Error('PRIVATE_DIAGNOSTIC');
        return { ok: false, reason: 'PRIVATE_DIAGNOSTIC' };
      } };
      const speaker = createCachedSpeaker({ speak: async () => ({ ok: true, value: audio }) }, cache, {
        ...identity, warn: entry => { warnings.push(entry); if (failure === 'logger-throw') throw new Error('log unavailable'); },
      });
      assert.deepEqual(await speaker.speak('非公開の会話'), { ok: true, value: { ...audio, cache: 'miss' } });
      assert.equal(warnings.length, 1);
      assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE_DIAGNOSTIC|非公開の会話/);
    });
  }
  it('When text is too long Then refuses it before even looking up the cache or calling the speaker', async () => {
    const cache: AudioCache = { get: async () => { throw new Error('Must not read'); }, put: async () => { throw new Error('Must not write'); } };
    const speaker: Speaker = { speak: async () => { throw new Error('Must not call provider'); } };
    assert.equal((await createCachedSpeaker(speaker, cache, options).speak('あ'.repeat(401))).ok, false);
  });
  it('When cache reading fails Then does not bypass the cache with a paid provider call', async () => {
    let calls = 0;
    const cache: AudioCache = { get: async () => ({ ok: false, reason: 'cache unavailable' }), put: async () => { throw new Error('Must not write'); } };
    const speaker = createCachedSpeaker({ speak: async () => { calls++; return { ok: true, value: audio }; } }, cache, options);
    assert.equal((await speaker.speak('こんにちは')).ok, false);
    assert.equal(calls, 0);
  });
  it('When the speaker fails Then preserves the failure and writes no cache entry', async () => {
    const cache: AudioCache = { get: async () => ({ ok: true, value: null }), put: async () => { throw new Error('Must not write'); } };
    const result = await createCachedSpeaker({ speak: async () => ({ ok: false, reason: 'provider unavailable' }) }, cache, options).speak('こんにちは');
    assert.deepEqual(result, { ok: false, reason: 'provider unavailable' });
  });
  it('When cancellation arrives during lookup Then does not start synthesis', async () => {
    const controller = new AbortController();
    const cache: AudioCache = { get: async () => { controller.abort(); return { ok: true, value: null }; }, put: async () => { throw new Error('Must not write'); } };
    const result = await createCachedSpeaker({ speak: async () => { throw new Error('Must not call provider'); } }, cache, options).speak('こんにちは', controller.signal);
    assert.equal(result.ok, false);
  });
});
