export function validateTranscriptionAudio(audio: unknown):
  { ok: true; value: Blob } | { ok: false; status: number; reason: string } {
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { ok: false, status: 400, reason: '비어 있지 않은 음성 파일 하나가 필요합니다.' };
  }
  if (audio.size > 2 * 1024 * 1024) return { ok: false, status: 413, reason: '음성 파일은 2 MB 이하여야 합니다.' };
  const mime = audio.type.split(';')[0]!.trim().toLowerCase();
  if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(mime)) {
    return { ok: false, status: 415, reason: '지원하지 않는 음성 파일 형식입니다.' };
  }
  return { ok: true, value: audio };
}
