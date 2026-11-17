export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
export interface TalkRateLimitBindings {
  TALK_AUDIO_LIMIT?: RateLimitBinding;
  TALK_TURN_LIMIT?: RateLimitBinding;
}
