import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pcm16ToWav } from '../../../src/domain/talk/audio.ts';

describe('Given Realtime PCM16 mono samples at 24 kHz', () => {
  it('When wrapping as WAV Then preserves samples and writes a correct RIFF header', () => {
    const pcm = new Uint8Array([0, 128, 255, 127]);
    const wav = pcm16ToWav(pcm);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (start: number, end: number) => new TextDecoder().decode(wav.subarray(start, end));
    assert.equal(wav.length, 48); assert.equal(ascii(0, 4), 'RIFF'); assert.equal(view.getUint32(4, true), 40);
    assert.equal(ascii(8, 16), 'WAVEfmt '); assert.equal(view.getUint32(16, true), 16);
    assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 24000); assert.equal(view.getUint32(28, true), 48000);
    assert.equal(view.getUint16(32, true), 2); assert.equal(view.getUint16(34, true), 16);
    assert.equal(ascii(36, 40), 'data'); assert.equal(view.getUint32(40, true), 4);
    assert.deepEqual(wav.subarray(44), pcm);
  });
  it('When the PCM is empty or incomplete Then refuses an invalid WAV', () => {
    assert.throws(() => pcm16ToWav(new Uint8Array()));
    assert.throws(() => pcm16ToWav(new Uint8Array([1])));
  });
});
