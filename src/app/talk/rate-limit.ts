import type { TalkRateLimitBindings } from '../../domain/talk/rate-limit.ts';

export async function checkTalkRateLimit(path: string, key: string, bindings: TalkRateLimitBindings): Promise<'allowed' | 'limited' | 'unavailable'> {
  const binding = ['/api/talk/speech', '/api/talk/transcribe'].includes(path) ? bindings.TALK_AUDIO_LIMIT
    : ['/api/talk/turn', '/api/talk/report'].includes(path) ? bindings.TALK_TURN_LIMIT : undefined;
  if (!binding) return 'allowed';
  try { return (await binding.limit({ key })).success ? 'allowed' : 'limited'; }
  catch { return 'unavailable'; }
}
