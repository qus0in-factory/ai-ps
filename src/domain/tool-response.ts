import type { Result } from './chat.ts';
import type { ToolResponse } from './tools.ts';

export function parseToolResponse(content: string): Result<ToolResponse> {
  let data: unknown;
  try {
    data = JSON.parse(content.trim());
  } catch {
    // Accept a single object wrapped in a code fence or explanatory text.
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    try {
      if (start < 0 || end < start) {
        return { ok: false, reason: '모델 응답이 올바른 JSON이 아닙니다. 다시 시도해주세요.' };
      }
      data = JSON.parse(content.slice(start, end + 1));
    } catch {
      return { ok: false, reason: '모델 응답이 올바른 JSON이 아닙니다. 다시 시도해주세요.' };
    }
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'type' in data) {
    if (data.type === 'message' && 'content' in data && typeof data.content === 'string' && data.content.trim()) {
      return { ok: true, value: { type: 'message', content: data.content } };
    }
    if (data.type === 'tool_call' && 'name' in data && typeof data.name === 'string' && data.name.trim() &&
        'arguments' in data && data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments)) {
      return { ok: true, value: {
        type: 'tool_call', name: data.name, arguments: data.arguments as Record<string, unknown>,
      } };
    }
  }
  return { ok: false, reason: '모델의 JSON 응답 형식이 올바르지 않습니다. 다시 시도해주세요.' };
}
