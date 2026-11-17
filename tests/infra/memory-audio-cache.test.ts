import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAudioCache } from '../../src/infra/memory-audio-cache.ts';

describe('Given a development memory audio cache', () => {
  it('When Node development supplies a Buffer Then stores its own bytes rather than a shared Buffer slice', async () => {
    const cache = createMemoryAudioCache();
    const bytes = Buffer.from([1, 2]);
    await cache.put('buffer', { bytes, mimeType: 'audio/wav' }, { model: 'tts', voice: 'coral' });
    bytes[0] = 99;
    const stored = await cache.get('buffer');
    assert.ok(stored.ok && stored.value);
    if (stored.ok && stored.value) assert.equal(stored.value.bytes[0], 1);
  });
  it('When audio is missing Then returns a successful miss; when stored Then returns independent byte copies', async () => {
    const cache = createMemoryAudioCache();
    assert.deepEqual(await cache.get('missing'), { ok: true, value: null });
    const bytes = new Uint8Array([1, 2]);
    assert.deepEqual(await cache.put('key', { bytes, mimeType: 'audio/wav' }, { model: 'tts', voice: 'coral' }), { ok: true, value: undefined });
    bytes[0] = 99;
    const first = await cache.get('key'); assert.ok(first.ok && first.value); if (!first.ok || !first.value) return;
    assert.deepEqual(first.value.bytes, new Uint8Array([1, 2]));
    first.value.bytes[1] = 88;
    assert.deepEqual(await cache.get('key'), { ok: true, value: { bytes: new Uint8Array([1, 2]), mimeType: 'audio/wav' } });
  });
});
