// 로그 개인정보 마스킹(설계 /tmp/logs-spec.md §3). 정규식은 모두 선형 시간 패턴만 쓴다.
// 키·토큰 패턴은 openai.ts의 기존 logCompletionError 정규식에서 옮겼다.

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const AUTH = /\b(?:Bearer|Basic)\s+[^\s,;"']+/gi;
const KEY_PREFIX = /\b(?:sk-|gsk_|xai-|hf_|AIza|AKIA)[a-zA-Z0-9_-]+/g;
const ASSIGNMENT = /(["']?(?:api[-_]?key|access[-_]?token|token|secret|password|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const PHONE = /(?:\+\d{1,3}[\s.-])?(?:\(?\d{2,4}\)?[\s.-])\d{3,4}[\s.-]\d{4}\b|\b01[016789]\d{7,8}\b/g;
// 구분자 없는 국제 전화(+821012345678). 단어에 붙은 + 는 건드리지 않는다.
const INTL_PHONE = /(?<!\w)\+[1-9]\d{6,14}\b/g;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,7}:[0-9a-f:]*/gi;
const LONG_TOKEN = /\b[a-zA-Z0-9_+\/=-]{32,}\b/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** 앞 2,000자만 처리하고 나머지는 버린다(설계 §3). */
const TEXT_LIMIT = 2_000;

/** URL은 자격증명을 버리고 쿼리 문자열만 `?[REDACTED]`로 가린다. */
function maskUrl(match: string): string {
  try {
    const parsed = new URL(match);
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?[REDACTED]' : ''}`;
  } catch {
    return '[KEY]';
  }
}

function maskText(text: string): string {
  return text
    .replace(URL_PATTERN, maskUrl)
    .replace(EMAIL, '[EMAIL]')
    .replace(AUTH, '[KEY]')
    .replace(KEY_PREFIX, '[KEY]')
    .replace(ASSIGNMENT, '$1[KEY]')
    .replace(PHONE, '[PHONE]')
    .replace(INTL_PHONE, '[PHONE]')
    .replace(IPV4, '[IP]')
    .replace(IPV6, '[IP]')
    .replace(LONG_TOKEN, '[KEY]')
    .replace(CONTROL, ' ');
}

/** 이메일·전화·IP·키·토큰·URL 쿼리를 범주별 치환값으로 가린다. */
export function redactText(input: string): string {
  if (input.length <= TEXT_LIMIT) return maskText(input);
  return `${maskText(input.slice(0, TEXT_LIMIT))}…(+${input.length - TEXT_LIMIT}자)`;
}

/** 제공사 진단은 호출자 키를 먼저 지우고 512자로 자른다(openai.ts logCompletionError용). */
export function redactDiagnostic(message: string, apiKey?: string): string {
  const key = apiKey?.trim();
  const stripped = key ? message.split(key).join('[REDACTED]') : message;
  return redactText(stripped).slice(0, 512);
}

function plainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 객체·배열을 깊이 6까지 순회하며 문자열에 redactText를 적용한다. 입력은 바꾸지 않는다. */
function walk(value: unknown, depth: number, stack: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6) return value;
  if (stack.has(value)) return '[Circular]';
  if (Array.isArray(value)) {
    stack.add(value);
    const copy = value.map(item => walk(item, depth + 1, stack));
    stack.delete(value);
    return copy;
  }
  if (!plainObject(value)) return value;
  stack.add(value);
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) copy[key] = walk(value[key], depth + 1, stack);
  stack.delete(value);
  return copy;
}

export function redactFields(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}
