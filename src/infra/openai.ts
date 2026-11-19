import type { CompletionGateway, CompletionMessage, CompletionOptions, CompletionParams, CompletionResponse, FunctionCompletionGateway } from '../domain/completion.ts';
import type { Result } from '../domain/chat.ts';
import type { ToolDefinition } from '../domain/tools.ts';
import { fetchWithRetry, isRetryableStatus } from './http-client.ts';

export const DEFAULT_FALLBACK_MODEL = 'gpt-6.1-terra';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_TIMEOUTS = { completion: 60_000, transcription: 30_000, speech: 30_000 } as const;
const INVALID_RESPONSE_FORMAT_REASON = '구조화 응답은 json_schema(strict)만 지원합니다.';

export interface OpenAIClient {
  apiKey?: string;
  baseUrl: string;
  fetcher: typeof fetch;
  timeouts: typeof OPENAI_TIMEOUTS;
  url(path: string): string;
}

/** One place for the OpenAI base URL, key, timeouts and retrying fetch. */
export function createOpenAIClient(config: {
  apiKey?: string; baseUrl?: string; fetcher?: typeof fetch;
} = {}): OpenAIClient {
  const baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    apiKey: config.apiKey,
    baseUrl,
    fetcher: config.fetcher ?? fetchWithRetry,
    timeouts: OPENAI_TIMEOUTS,
    url: path => `${baseUrl}${path}`,
  };
}

function isRetryableCompletionFailure(reason: string, signal?: AbortSignal): boolean {
  if (signal?.aborted || reason === '모델 API 키가 설정되지 않았습니다.' || reason === INVALID_RESPONSE_FORMAT_REASON) return false;
  const status = Number(reason.match(/\(HTTP (\d+)\)/)?.[1]);
  return Number.isFinite(status) ? isRetryableStatus(status) : true;
}

type ProviderCompletionParams = Omit<CompletionParams, 'tools'> & {
  tools?: { type: 'function'; function: ToolDefinition & { strict: boolean } }[];
};

// Provider diagnostics are untrusted: never reuse them as a public failure reason.
function logCompletionError(message: string, apiKey: string | undefined, status?: number, debug = false, timedOut = false) {
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
    const entry = { event: 'completion_error', code: timedOut ? 'provider_timeout' : status === undefined ? 'provider_connection_error' : 'provider_http_error', ...(status === undefined ? {} : { status }) };
    console.error(entry);
    if (debug) console.debug({ ...entry, message: redacted });
  } catch {
    // Logging must not turn a safe failure into an exception.
  }
}

export async function completion(
  params: ProviderCompletionParams,
  options: { client?: OpenAIClient; apiKey?: string; baseUrl?: string; signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch; debugErrors?: boolean; logErrors?: boolean } = {},
): Promise<Result<CompletionResponse>> {
  const client = options.client ?? createOpenAIClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetcher: options.fetcher });
  const apiKey = client.apiKey ?? process.env.OPENAI_API_KEY;
  let signal: AbortSignal | undefined;
  try {
    const responseFormat = params.response_format as { type?: unknown; json_schema?: { strict?: unknown } } | undefined;
    if (responseFormat && (responseFormat.type !== 'json_schema' || responseFormat.json_schema?.strict !== true)) {
      return { ok: false, reason: INVALID_RESPONSE_FORMAT_REASON };
    }
    if (!apiKey?.trim()) {
      return { ok: false, reason: '모델 API 키가 설정되지 않았습니다.' };
    }

    const timeout = AbortSignal.timeout(options.timeoutMs ?? client.timeouts.completion);
    signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await (options.fetcher ?? client.fetcher)(client.url('/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...params, stream: false }),
      signal,
    });

    if (!response.ok) {
      if (options.logErrors === false) {
        void response.body?.cancel().catch(() => {});
        return { ok: false, reason: `모델 공급자 요청에 실패했습니다. (HTTP ${response.status})` };
      }
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
      logCompletionError(message, apiKey, response.status, options.debugErrors === true);
      return { ok: false, reason: `모델 공급자 요청에 실패했습니다. (HTTP ${response.status})` };
    }

    return { ok: true, value: (await response.json()) as CompletionResponse };
  } catch (error) {
    const timedOut = (signal?.aborted && signal.reason?.name === 'TimeoutError') ||
      (error instanceof Error && error.name === 'TimeoutError');
    if (options.logErrors !== false) logCompletionError(error instanceof Error ? error.message : 'Unknown provider failure', apiKey, undefined, options.debugErrors === true, timedOut);
    return { ok: false, reason: timedOut ? '모델 응답 시간이 초과되었습니다.' : '모델 공급자에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

export function createOpenAICompletion(
  config: { client?: OpenAIClient; model?: string; fallbackModel?: string; apiKey?: string; baseUrl?: string; fetcher?: typeof fetch; debugErrors?: boolean; logErrors?: boolean; strictTools?: boolean; reasoningEffort?: 'none' | 'low' | 'medium' | 'high' },
): CompletionGateway & FunctionCompletionGateway {
  const client = config.client ?? createOpenAIClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetcher: config.fetcher });
  return {
    async complete(messages: CompletionMessage[], options: ToolDefinition[] | CompletionOptions = {}, nativeOptions: CompletionOptions = {}) {
      const tools = Array.isArray(options) ? options : [];
      const settings = Array.isArray(options) ? nativeOptions : options;
      const responseFormat = settings.response_format;
      const model = config.model?.trim();
      if (!model) return { ok: false, reason: 'OPENAI_MODEL을 .env에 설정해주세요.' };
      const functions = tools.map((definition) => ({
        type: 'function' as const, function: { ...definition, strict: config.strictTools ?? true },
      }));
      const params = {
        messages,
        ...(settings.max_completion_tokens !== undefined ? { max_completion_tokens: settings.max_completion_tokens } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
        ...(functions.length && settings.tool_choice ? { tool_choice: settings.tool_choice } : {}),
        ...(functions.length && settings.parallel_tool_calls !== undefined ? { parallel_tool_calls: settings.parallel_tool_calls } : {}),
        ...(functions.length ? { tools: functions, reasoning_effort: 'none' as const }
          : config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        ...(settings.reasoning_effort !== undefined ? { reasoning_effort: settings.reasoning_effort } : {}),
      };
      const callOptions = {
        client, debugErrors: config.debugErrors, logErrors: config.logErrors, signal: settings.signal, timeoutMs: settings.timeoutMs,
      };
      let result = await completion({ model, ...params }, callOptions);
      if (!result.ok && isRetryableCompletionFailure(result.reason, settings.signal)) {
        const fallback = (config.fallbackModel ?? process.env.OPENAI_FALLBACK_MODEL)?.trim() || DEFAULT_FALLBACK_MODEL;
        if (fallback && fallback !== model) {
          result = await completion({ model: fallback, ...params }, { ...callOptions, fetcher: config.fetcher ?? fetch });
        }
      }
      if (!result.ok) return result;
      const message = result.value.choices?.[0]?.message;
      return message ? { ok: true, value: message }
        : { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
    },
  };
}
