import type { Result } from '../chat.ts';

export const MAX_TTS_TEXT_LENGTH = 200;

export const TALK_FIXED_PHRASES = Object.freeze({
  greeting: 'こんにちは。今日は何について話しましょうか？',
  morning: 'おはようございます。今日はどんな一日にしたいですか？',
  evening: 'こんばんは。今日はどんな一日でしたか？',
  repeat: 'もう一度言ってもらえますか？',
  encourage: 'いいですね。もう少し教えてください。',
});

// Audio ports match design §4 without changing the text conversation module.
export interface AudioClip { bytes: Uint8Array; mimeType: 'audio/wav' }
export interface Speaker { speak(text: string, signal?: AbortSignal): Promise<Result<AudioClip>> }
export interface CachedAudioClip extends AudioClip { cache: 'hit' | 'miss' }
export interface CachedSpeaker extends Speaker {
  speak(text: string, signal?: AbortSignal): Promise<Result<CachedAudioClip>>;
}
export interface SpeechCacheIdentity { model: string; voice: string; promptVersion: string }
export type AudioMetadata = Pick<SpeechCacheIdentity, 'model' | 'voice'>;
export interface AudioCache {
  get(key: string): Promise<Result<AudioClip | null>>;
  put(key: string, audio: AudioClip, metadata: AudioMetadata): Promise<Result<void>>;
}
export interface SpeechCacheWarning { event: 'tts_cache_put_failed'; key: string }

export async function createSpeechCacheKey(text: string, identity: SpeechCacheIdentity): Promise<Result<{ key: string; text: string }>> {
  try {
    if (typeof text !== 'string') return { ok: false, reason: '음성 입력은 문자열이어야 합니다.' };
    const normalized = text.normalize('NFC').trim().replace(/\s+/gu, ' ');
    if (!normalized || Array.from(normalized).length > MAX_TTS_TEXT_LENGTH) {
      return { ok: false, reason: `음성 입력은 1~${MAX_TTS_TEXT_LENGTH}자여야 합니다.` };
    }
    const tags = [identity.model, identity.voice, identity.promptVersion];
    if (tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.includes('|'))) {
      return { ok: false, reason: '음성 캐시 설정이 올바르지 않습니다.' };
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...tags, normalized].join('|')));
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { ok: true, value: { key: `tts/v1/${hex}.wav`, text: normalized } };
  } catch {
    return { ok: false, reason: '음성 캐시 키를 만들지 못했습니다.' };
  }
}
