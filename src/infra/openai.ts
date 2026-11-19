import type { CompletionGateway, CompletionMessage, CompletionOptions, CompletionParams, CompletionResponse, FunctionCompletionGateway } from '../domain/completion.ts';
import type { Result } from '../domain/chat.ts';
import type { ToolDefinition } from '../domain/tools.ts';
import { redactDiagnostic } from '../domain/redact.ts';
import { fetchWithRetry, isRetryableStatus } from './http-client.ts';
import { createConsoleLogger } from './console-logger.ts';

export const DEFAULT_FALLBACK_MODEL = 'gpt-6.1-terra';
const logger = createConsoleLogger();
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_TIMEOUTS = { completion: 60_000, transcription: 30_000, speech: 30_000 } as const;
const INVALID_RESPONSE_FORMAT_REASON = '구조화 응답은 json_schema(strict)만 지원합니다.';
const ROUTE_THRESHOLD = 0.6;
const ROUTE_TIMEOUT_MS = 2_000;
const ROUTE_SKIP_MS = 60_000;
const DECISION_REQUEST = {
  model: 'gpt-6-luna',
  questions: [{
    type: 'choice', name: 'route',
    instructions: '사용자 요청 하나를 읽고 필요한 추론의 깊이로 분류한다. 한 번에 바로 답하거나 조회 한 번으로 끝나면 luna, 여러 요소를 비교·종합하거나 단계를 세워야 답할 수 있으면 terra다. 답의 길이가 아니라 추론 단계 수로 판단한다.',
    choices: [
      { value: 'luna', description: '인사·감사, 단일 사실·정의·계산 하나, 현재 시각이나 한 도시의 날씨처럼 조회 한 번으로 끝나는 요청' },
      { value: 'terra', description: '둘 이상의 대상 비교·분석·추천, 계획·일정·단계 분해, 요약과 인사이트 도출, 글 다듬기·작성, 코드 분석·개선처럼 여러 단계의 추론이 필요한 요청' },
    ],
  }],
} as const;

interface RoutingConfig { complexModel: string; threshold?: number; keys?: string[] }

export interface OpenAIUsageRecord {
  op: 'realtime';
  model?: string | null;
  status: number;
  ms: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface OpenAIClient {
  apiKey?: string;
  baseUrl: string;
  fetcher: typeof fetch;
  timeouts: typeof OPENAI_TIMEOUTS;
  url(path: string): string;
  record?: (event: OpenAIUsageRecord) => void;
}

/** One place for the OpenAI base URL, key, timeouts and retrying fetch. */
export function createOpenAIClient(config: {
  apiKey?: string; baseUrl?: string; fetcher?: typeof fetch; record?: (event: OpenAIUsageRecord) => void;
} = {}): OpenAIClient {
  const baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    apiKey: config.apiKey,
    baseUrl,
    fetcher: config.fetcher ?? fetchWithRetry,
    timeouts: OPENAI_TIMEOUTS,
    url: path => `${baseUrl}${path}`,
    record: config.record,
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
  const redacted = redactDiagnostic(message, apiKey);
  try {
    const entry = { event: 'completion_error', code: timedOut ? 'provider_timeout' : status === undefined ? 'provider_connection_error' : 'provider_http_error', ...(status === undefined ? {} : { status }) };
    logger.error(entry);
    if (debug) logger.info({ ...entry, message: redacted });
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

/** 분류는 생성 직전 1회. 어떤 실패도 생성 실패로 번지지 않고 기본 모델을 쓴다. */
async function routeCompletionModel(
  routing: RoutingConfig | undefined, messages: CompletionMessage[], client: OpenAIClient,
  signal: AbortSignal | undefined, skipUntil: { value: number }, cacheKey: string | undefined,
): Promise<string | undefined> {
  const complex = routing?.complexModel?.trim();
  if (!complex || Date.now() < skipUntil.value) return undefined;
  if (routing?.keys && (!cacheKey || !routing.keys.includes(cacheKey))) return undefined;
  const apiKey = client.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return undefined;
  // 내부 JSON(wrapUntrusted·assigned_task)이 아니라 사용자의 실제 질문만 분류한다.
  const question = [...messages].reverse().find(message => {
    if (message.role !== 'user') return false;
    const content = message.content?.trimStart() ?? '';
    return !content.startsWith('<untrusted') && !content.startsWith('{');
  });
  if (!question) return undefined;
  const skip = () => { skipUntil.value = Date.now() + ROUTE_SKIP_MS; };
  try {
    const timeout = AbortSignal.timeout(ROUTE_TIMEOUT_MS);
    const routeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const input = question.content?.slice(0, 2_000) ?? '';
    const response = await client.fetcher(client.url('/decisions'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DECISION_REQUEST, input }),
      signal: routeSignal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      skip();
      return undefined;
    }
    const data = await response.json() as { answers?: { type?: unknown; choice?: unknown; confidence?: unknown }[] };
    const answer = data.answers?.[0];
    return answer?.type === 'choice' && answer.choice === 'terra' &&
      typeof answer.confidence === 'number' && answer.confidence >= (routing?.threshold ?? ROUTE_THRESHOLD)
      ? complex : undefined;
  } catch {
    skip();
    return undefined;
  }
}

export function createOpenAICompletion(
  config: { client?: OpenAIClient; model?: string; fallbackModel?: string; apiKey?: string; baseUrl?: string; fetcher?: typeof fetch; debugErrors?: boolean; logErrors?: boolean; strictTools?: boolean; reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; routing?: RoutingConfig },
): CompletionGateway & FunctionCompletionGateway {
  const client = config.client ?? createOpenAIClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetcher: config.fetcher });
  const skipUntil = { value: 0 };
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
        ...(settings.prompt_cache_key !== undefined ? { prompt_cache_key: settings.prompt_cache_key } : {}),
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
      const selected = await routeCompletionModel(config.routing, messages, client, settings.signal, skipUntil, settings.prompt_cache_key) ?? model;
      let result = await completion({ model: selected, ...params }, callOptions);
      if (!result.ok && isRetryableCompletionFailure(result.reason, settings.signal)) {
        const fallback = selected !== model ? model
          : (config.fallbackModel ?? process.env.OPENAI_FALLBACK_MODEL)?.trim() || DEFAULT_FALLBACK_MODEL;
        if (fallback && fallback !== selected) {
          result = await completion({ model: fallback, ...params }, callOptions);
        }
      }
      if (!result.ok) return result;
      const message = result.value.choices?.[0]?.message;
      return message ? { ok: true, value: message }
        : { ok: false, reason: '응답이 비어 있습니다. 다시 시도해주세요.' };
    },
  };
}
