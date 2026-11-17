import type { Result } from '../../domain/chat.ts';
import { MAX_TTS_TEXT_LENGTH } from '../../domain/talk/speech-cache.ts';

export function parseSpeechRequest(body: unknown): Result<string> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
    !('text' in body) || typeof body.text !== 'string' || !body.text.trim() || [...body.text].length > MAX_TTS_TEXT_LENGTH) {
    return { ok: false, reason: `음성 입력은 text 필드의 1~${MAX_TTS_TEXT_LENGTH}자 문자열이어야 합니다.` };
  }
  return { ok: true, value: body.text };
}
