/** Realtime output is signed 16-bit little-endian PCM, 24 kHz, mono. */
export function pcm16ToWav(pcm: Uint8Array): Uint8Array {
  if (!pcm.length || pcm.length % 2) throw new RangeError('PCM16 samples must be nonempty and complete.');
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}
