import type { CompletionGateway, CompletionMessage, CompletionOptions, CompletionParams, CompletionResponse, FunctionCompletionGateway } from '../domain/completion.ts';
import type { Result } from '../domain/chat.ts';
import type { ToolDefinition } from '../domain/tools.ts';

export async function completion(
  params: CompletionParams,
  options: { apiKey?: string; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<Result<CompletionResponse>> {
  try {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error('OPENAI_API_KEY is required');
    }

    const response = await (options.fetcher ?? fetch)('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...params, stream: false }),
      signal: options.signal ?? AbortSignal.timeout(60_000),
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
      throw new Error(`OpenAI API error (${response.status}): ${message}`);
    }

    return { ok: true, value: (await response.json()) as CompletionResponse };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '응답을 가져오지 못했습니다.' };
  }
}

export function createOpenAICompletion(
  config: { model?: string; apiKey?: string; fetcher?: typeof fetch },
): CompletionGateway & FunctionCompletionGateway {
  return {
    async complete(messages: CompletionMessage[], options: ToolDefinition[] | CompletionOptions = {}) {
      const tools = Array.isArray(options) ? options : [];
      const responseFormat = Array.isArray(options) ? undefined : options.response_format;
      const model = config.model?.trim();
      if (!model) return { ok: false, reason: 'OPENAI_MODEL을 .env에 설정해주세요.' };
      const functions = tools.map((definition) => ({
        type: 'function' as const, function: { ...definition, strict: true as const },
      }));
      const result = await completion({
        model, messages,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(functions.length ? { tools: functions, reasoning_effort: 'none' as const } : {}),
      }, {
        apiKey: config.apiKey, fetcher: config.fetcher,
      });
      if (!result.ok) return result;
      const message = result.value.choices?.[0]?.message;
      return message ? { ok: true, value: message }
        : { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
    },
  };
}
