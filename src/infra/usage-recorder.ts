import { costUsd, type UsageEvent, type UsageOp, type UsageService } from '../domain/usage.ts';

export interface UsagePreparedStatement {
  bind(...values: unknown[]): UsagePreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/** Minimal D1 surface used by the recorder and the stats endpoint. */
export interface UsageDatabase {
  prepare(query: string): UsagePreparedStatement;
  batch(statements: UsagePreparedStatement[]): Promise<unknown>;
}

export interface UsageRecorder {
  wrap(service: UsageService): typeof fetch;
  record(event: UsageEvent): void;
  flush(): Promise<void>;
}

interface UsageRow {
  ts: number;
  route: string;
  service: UsageService;
  op: UsageOp;
  model: string | null;
  status: number;
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  costUsd: number;
}

const INSERT = 'INSERT INTO usage_events (ts, route, service, op, model, status, ms, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function operation(service: UsageService, url: string): UsageOp {
  if (service !== 'openai') return 'search';
  const path = new URL(url).pathname;
  if (path.endsWith('/chat/completions')) return 'completion';
  if (path.endsWith('/audio/transcriptions')) return 'transcribe';
  if (path.endsWith('/decisions')) return 'decision';
  return 'search';
}

function formModel(body: BodyInit | null | undefined): string | null {
  if (!body || typeof FormData === 'undefined' || !(body instanceof FormData)) return null;
  const model = body.get('model');
  return typeof model === 'string' && model.trim() ? model : null;
}

/** Decisions 응답에 model이 없으면 요청 JSON의 model을 쓴다. */
function jsonModel(body: BodyInit | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  try {
    const data: unknown = JSON.parse(body);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const model = (data as { model?: unknown }).model;
      return typeof model === 'string' && model.trim() ? model : null;
    }
  } catch { /* 비JSON 본문에는 모델이 없다. */ }
  return null;
}

async function responseUsage(response: Response, op: UsageOp, requestBody: BodyInit | null | undefined) {
  const usage = { model: op === 'transcribe' ? formModel(requestBody) : op === 'decision' ? jsonModel(requestBody) : null,
    inputTokens: null as number | null, outputTokens: null as number | null, cachedTokens: null as number | null };
  if (!response.ok) return usage;
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return usage;
    const data = body as { model?: unknown; usage?: unknown };
    if (typeof data.model === 'string' && data.model.trim()) usage.model = data.model;
    if (data.usage && typeof data.usage === 'object' && !Array.isArray(data.usage)) {
      const tokens = data.usage as {
        prompt_tokens?: unknown; input_tokens?: unknown; completion_tokens?: unknown;
        prompt_tokens_details?: unknown; input_tokens_details?: unknown;
      };
      if (typeof tokens.prompt_tokens === 'number' && Number.isFinite(tokens.prompt_tokens)) usage.inputTokens = tokens.prompt_tokens;
      if (usage.inputTokens === null && typeof tokens.input_tokens === 'number' && Number.isFinite(tokens.input_tokens)) usage.inputTokens = tokens.input_tokens;
      if (typeof tokens.completion_tokens === 'number' && Number.isFinite(tokens.completion_tokens)) usage.outputTokens = tokens.completion_tokens;
      // 캐시 적중 토큰(§16): completion은 prompt_tokens_details, 그 외는 input_tokens_details에 온다.
      for (const details of [tokens.prompt_tokens_details, tokens.input_tokens_details]) {
        const cached = details && typeof details === 'object' && !Array.isArray(details)
          ? (details as { cached_tokens?: unknown }).cached_tokens : undefined;
        if (typeof cached === 'number' && Number.isFinite(cached)) { usage.cachedTokens = cached; break; }
      }
    }
  } catch {
    // The caller still owns the original response; a non-JSON body has no usage.
  }
  return usage;
}

/** Collects one usage row per external attempt; the worker flushes them once per request. */
export function createUsageRecorder(options: {
  db?: UsageDatabase;
  route: string;
  now?: () => number;
}): UsageRecorder {
  const db = options.db;
  const now = options.now ?? Date.now;
  const events: UsageRow[] = [];

  if (!db) {
    return {
      wrap: () => globalThis.fetch,
      record: () => {},
      flush: async () => {},
    };
  }

  const add = (event: UsageEvent) => {
    const row: UsageRow = {
      ts: now(),
      route: options.route,
      service: event.service,
      op: event.op,
      model: event.model ?? null,
      status: event.status,
      ms: Math.max(0, Math.round(event.ms)),
      inputTokens: event.inputTokens ?? null,
      outputTokens: event.outputTokens ?? null,
      cachedTokens: event.cachedTokens ?? null,
      costUsd: costUsd(event),
    };
    events.push(row);
  };

  return {
    wrap(service) {
      return async (input, init) => {
        const started = now();
        const url = requestUrl(input);
        const op = operation(service, url);
        try {
          const response = await globalThis.fetch(input, init);
          const usage = service === 'openai' ? await responseUsage(response, op, init?.body) : { model: null, inputTokens: null, outputTokens: null, cachedTokens: null };
          add({ service, op, ...usage, status: response.status, ms: now() - started });
          return response;
        } catch (error) {
          add({ service, op, model: op === 'transcribe' ? formModel(init?.body) : null, status: 0, ms: now() - started });
          throw error;
        }
      };
    },
    record(event) {
      add(event);
    },
    async flush() {
      if (!events.length) return;
      const rows = events.splice(0);
      await db.batch(rows.map(row => db.prepare(INSERT).bind(
        row.ts, row.route, row.service, row.op, row.model, row.status, row.ms,
        row.inputTokens, row.outputTokens, row.cachedTokens, row.costUsd,
      )));
    },
  };
}
