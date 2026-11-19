import type { Result } from '../chat.ts';
import { TOPIC_MAX } from './constants.ts';

export { TOPIC_MAX } from './constants.ts';

/** 주제를 앞뒤 공백 정리 후 1~TOPIC_MAX자로 검증한다. */
export function validateTopic(topic: string): Result<string> {
  const trimmed = topic.trim();
  if (!trimmed || trimmed.length > TOPIC_MAX) {
    return { ok: false, reason: `주제는 1~${TOPIC_MAX}자로 입력해 주세요.` };
  }
  return { ok: true, value: trimmed };
}
