import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTranscriptionAudio } from '../../../src/app/talk/transcribe.ts';

describe('Given an uploaded Japanese speech file', () => {
  it('When a supported nonempty file is within 2 MiB Then accepts it including codec parameters', () => {
    for (const type of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav']) {
      assert.equal(validateTranscriptionAudio(new Blob([new Uint8Array(2 * 1024 * 1024)], { type })).ok, true);
    }
  });
  it('When missing, empty, oversized or unsupported Then rejects before transcription', () => {
    for (const [audio, status] of [[null, 400], ['audio', 400], [new Blob([], { type: 'audio/wav' }), 400],
      [new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'audio/wav' }), 413],
      [new Blob(['x'], { type: 'text/plain' }), 415]] as const) {
      const result = validateTranscriptionAudio(audio);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, status);
    }
  });
});
