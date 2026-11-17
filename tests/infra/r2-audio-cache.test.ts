import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createR2AudioCache, type R2Bucket } from '../../src/infra/r2-audio-cache.ts';

describe('Given an R2 audio cache binding', () => {
  it('When reading Then distinguishes missing objects and loads WAV bytes', async () => {
    const cache = createR2AudioCache({ get: async key => key === 'missing' ? null : { arrayBuffer: async () => new Uint8Array([1, 2]).buffer }, put: async () => null });
    assert.deepEqual(await cache.get('missing'), { ok: true, value: null });
    assert.deepEqual(await cache.get('hit'), { ok: true, value: { bytes: new Uint8Array([1, 2]), mimeType: 'audio/wav' } });
  });
  it('When putting a sliced byte view Then writes exactly those bytes with WAV and model/voice metadata', async () => {
    let calls = 0;
    const bucket: R2Bucket = { get: async () => null, put: async (key, bytes, options) => {
      calls++; assert.equal(key, 'tts/v1/example.wav');
      assert.deepEqual(new Uint8Array(bytes), new Uint8Array([1, 2]));
      assert.deepEqual(options, { httpMetadata: { contentType: 'audio/wav' }, customMetadata: { model: 'tts', voice: 'coral' } });
      return null;
    } };
    const cache = createR2AudioCache(bucket);
    assert.equal((await cache.put('tts/v1/example.wav', { bytes: new Uint8Array([9, 1, 2, 8]).subarray(1, 3), mimeType: 'audio/wav' }, { model: 'tts', voice: 'coral' })).ok, true);
    assert.equal(calls, 1);
  });
  it('When R2 operations fail Then returns generic results without the raw diagnostic', async () => {
    const cache = createR2AudioCache({ get: async () => { throw new Error('PRIVATE_R2_ERROR'); }, put: async () => { throw new Error('PRIVATE_R2_ERROR'); } });
    const results = [await cache.get('key'), await cache.put('key', { bytes: new Uint8Array([1]), mimeType: 'audio/wav' }, { model: 'tts', voice: 'coral' })];
    assert.ok(results.every(result => !result.ok));
    assert.doesNotMatch(JSON.stringify(results), /PRIVATE_R2_ERROR/);
  });
});
