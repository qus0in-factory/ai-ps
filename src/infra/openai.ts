import type { CompletionGateway, CompletionMessage, CompletionOptions, CompletionParams, CompletionResponse, FunctionCompletionGateway } from '../domain/completion.ts';
import type { Result } from '../domain/chat.ts';
import type { ToolDefinition } from '../domain/tools.ts';

// Provider diagnostics are untrusted: never reuse them as a public failure reason.
function logCompletionError(message: string, apiKey: string | undefined, status?: number) {
  const key = apiKey?.trim();
  const redacted = (key ? message.split(key).join('[REDACTED]') : message)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[REDACTED_URL]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[REDACTED_AUTH]')
    .replace(/\b(?:sk-|gsk_|xai-|hf_|AIza|AKIA)[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/(["']?(?:api[-_]?key|access[-_]?token|token|secret|password|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b[a-zA-Z0-9_+\/=-]{32,}\b/g, '[REDACTED_KEY]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 512);
  try {
    console.error({ event: 'completion_error', ...(status === undefined ? {} : { status }), message: redacted });
  } catch {
    // Logging must not turn a safe failure into an exception.
  }
}

export async function completion(
  params: CompletionParams,
  options: { apiKey?: string; baseUrl?: string; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<Result<CompletionResponse>> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  try {
    if (!apiKey?.trim()) {
      return { ok: false, reason: '모델 API 키가 설정되지 않았습니다.' };
    }

    const baseUrl = (options.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const response = await (options.fetcher ?? fetch)(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...params, stream: false }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text();
      let message = response.statusText;
      try {
        const data = JSON.parse(body);
        if (typeof data.error?.message === 'string') {
          message = data.error.message;
        }
      } catch {
        // Gateways may return HTML or plain text instead of an API error.
      }
      logCompletionError(message, apiKey, response.status);
      return { ok: false, reason: `모델 공급자 요청에 실패했습니다. (HTTP ${response.status})` };
    }

    return { ok: true, value: (await response.json()) as CompletionResponse };
  } catch (error) {
    logCompletionError(error instanceof Error ? error.message : 'Unknown provider failure', apiKey);
    return { ok: false, reason: '모델 공급자에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export function createOpenAICompletion(
  config: { model?: string; apiKey?: string; baseUrl?: string; fetcher?: typeof fetch },
): CompletionGateway & FunctionCompletionGateway {
  return {
    async complete(messages: CompletionMessage[], options: ToolDefinition[] | CompletionOptions = {}, nativeOptions: CompletionOptions = {}) {
      const tools = Array.isArray(options) ? options : [];
      const settings = Array.isArray(options) ? nativeOptions : options;
      const responseFormat = settings.response_format;
      const model = config.model?.trim();
      if (!model) return { ok: false, reason: 'OPENAI_MODEL을 .env에 설정해주세요.' };
      const functions = tools.map((definition) => ({
        type: 'function' as const, function: { ...definition, strict: true as const },
      }));
      const result = await completion({
        model, messages,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
        ...(settings.tool_choice ? { tool_choice: settings.tool_choice } : {}),
        ...(settings.parallel_tool_calls !== undefined ? { parallel_tool_calls: settings.parallel_tool_calls } : {}),
        ...(functions.length ? { tools: functions, reasoning_effort: 'none' as const } : {}),
      }, {
        apiKey: config.apiKey, baseUrl: config.baseUrl, fetcher: config.fetcher, signal: settings.signal,
      });
      if (!result.ok) return result;
      const message = result.value.choices?.[0]?.message;
      return message ? { ok: true, value: message }
        : { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
    },
  };
}
