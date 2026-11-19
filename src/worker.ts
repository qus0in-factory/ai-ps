import { createR2AudioCache, type R2Bucket } from './infra/r2-audio-cache.ts';
import { createCachedSpeaker } from './app/talk/cached-speaker.ts';
import { createRealtimeSpeaker, connectWorkers, REALTIME_SPEECH_PROMPT_VERSION } from './infra/openai-realtime-speech.ts';
import { createGameMaster } from './app/adventure/game-master.ts';
import { createAdventureLogger } from './infra/adventure-logger.ts';
import { createReply } from './app/chat.ts';
import { createQueensService } from './app/queens/service.ts';
import { createQueensGenerator } from './app/queens/generator.ts';
import { createToolChat } from './app/tool-chat.ts';
import { createPlanExecuteChat } from './app/plan-execute-chat.ts';
import { createFunctionToolChat } from './app/function-tool-chat.ts';
import { createTools } from './infra/tools.ts';
import { createToolLogger } from './infra/tool-logger.ts';
import { createQueensLogger } from './infra/queens-logger.ts';
import { createConsoleLogger } from './infra/console-logger.ts';
import { createOpenAIClient, createOpenAICompletion } from './infra/openai.ts';
import { createHttpClient } from './infra/http-client.ts';
import { createUsageRecorder, type UsageDatabase, type UsageRecorder } from './infra/usage-recorder.ts';
import { createApi } from './ui/http/api.ts';
import { createTutor } from './app/talk/tutor.ts';
import { createOpenAITranscriber } from './infra/openai-transcribe.ts';
import { createTalkLogger } from './infra/talk-logger.ts';
import { limitTalkRequest } from './ui/http/talk-rate-limit.ts';
import type { TalkRateLimitBindings } from './domain/talk/rate-limit.ts';
import { getPath } from 'hono/utils/url';
import { createResearchAgent } from './app/research/agent.ts';
import { createBraveSearch } from './infra/research-brave-search.ts';
import { createNcpSearch } from './infra/research-ncp-search.ts';
import { createMergedResearchSearch } from './infra/research-merged-search.ts';
import { createResearchWebReader } from './infra/research-web-reader.ts';
import { createResearchRateLimit } from './infra/research-rate-limit.ts';
import { createResearchApi, type ResearchRequestMetrics } from './ui/http/research-api.ts';
import type { ResearchRateLimitBinding } from './domain/research/rate-limit.ts';

export interface Env extends TalkRateLimitBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TALK_AUDIO?: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_FALLBACK_MODEL?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  OPENAI_REALTIME_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  OPENAI_TOOL_MODE?: string;
  OPENAI_BASE_URL?: string;
  OWM_API_KEY?: string;
  LOG_LEVEL?: string;
  ADVENTURE_TEMPERATURE?: string;
  BRAVE_SEARCH_API_KEY?: string;
  NCP_API_KEY_ID?: string;
  NCP_API_KEY?: string;
  RESEARCH_LIMIT?: ResearchRateLimitBinding;
  USAGE_DB?: UsageDatabase;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function createResearchEndpoint(
  env: Pick<Env, 'OPENAI_MODEL' | 'OPENAI_FALLBACK_MODEL' | 'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'BRAVE_SEARCH_API_KEY' | 'NCP_API_KEY_ID' | 'NCP_API_KEY' | 'RESEARCH_LIMIT'>,
  options: { requireLimitBinding?: boolean; log?: (metrics: ResearchRequestMetrics) => void; recorder?: UsageRecorder } = {},
) {
  return createResearchApi({
    limit: createResearchRateLimit(env.RESEARCH_LIMIT, { required: options.requireLimitBinding }), log: options.log,
    run: async (topic, external) => {
      const hasBrave = Boolean(env.BRAVE_SEARCH_API_KEY?.trim());
      const hasNcp = Boolean(env.NCP_API_KEY_ID?.trim() && env.NCP_API_KEY?.trim());
      if (!env.OPENAI_API_KEY?.trim() || !env.OPENAI_MODEL?.trim() || !hasBrave && !hasNcp) {
        return { ok: false, reason: '리서치 공급자 설정이 필요합니다.' };
      }
      const signal = AbortSignal.any([external, AbortSignal.timeout(540_000)]);
      const retrying = (service: 'openai' | 'brave' | 'ncp') => options.recorder
        ? createHttpClient({ fetcher: options.recorder.wrap(service) }) : undefined;
      const openai = createOpenAIClient({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, fetcher: retrying('openai') });
      const model = createOpenAICompletion({ client: openai, model: env.OPENAI_MODEL, fallbackModel: env.OPENAI_FALLBACK_MODEL,
        logErrors: false, strictTools: false });
      const search = createMergedResearchSearch([
        ...(hasBrave ? [createBraveSearch({ apiKey: env.BRAVE_SEARCH_API_KEY, fetcher: retrying('brave') })] : []),
        ...(hasNcp ? [createNcpSearch({ apiKeyId: env.NCP_API_KEY_ID, apiKey: env.NCP_API_KEY, fetcher: retrying('ncp') })] : []),
      ]);
      const allowedHosts = new Set<string>();
      const reader = createResearchWebReader({ allowedHosts, allowIpLiterals: false });
      return createResearchAgent({
        model: { complete: (messages, tools, settings) => model.complete(messages, tools, { ...settings, signal }) },
        search: async (query, max) => {
          const result = await search.search(query, max, signal);
          if (!result.ok) return result;
          for (const hit of result.value) allowedHosts.add(new URL(hit.url).hostname.replace(/\.$/, ''));
          return { ok: true, value: result.value.map(({ title, url, description }) => ({ title, url, summary: description })) };
        },
        read: async url => {
          const result = await reader.read(url, signal);
          return result.ok ? { ok: true, value: `제목: ${result.value.title || result.value.url}\n주소: ${result.value.url}\n\n${result.value.content}` } : result;
        },
      }).run(topic);
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx?: WorkerContext): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const logger = createConsoleLogger({ level: env.LOG_LEVEL });
    const recorder = createUsageRecorder({ db: env.USAGE_DB, route: getPath(request), now: Date.now });
    const flushNow = () => recorder.flush().catch(() => logger.warn({ event: 'usage_flush_error' }));
    const flushUsage = () => {
      const pending = flushNow();
      if (ctx) ctx.waitUntil(pending);
      else return pending;
    };
    if (getPath(request) === '/api/research') {
      const response = await createResearchEndpoint(env, {
        requireLimitBinding: true, log: metrics => logger.info(metrics), recorder,
      }).fetch(request);
      await flushUsage();
      return response;
    }
    const talkLog = createTalkLogger(logger);
    const limited = await limitTalkRequest(request, env, talkLog);
    if (limited) { await flushUsage(); return limited; }
    const createGateway = env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
      : ['json', 'react'].includes(env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
    const openaiFetcher = createHttpClient({ fetcher: recorder.wrap('openai') });
    const openai = createOpenAIClient({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, fetcher: openaiFetcher,
      record: event => recorder.record({
        service: 'openai', op: event.op, model: event.model, status: event.status, ms: event.ms,
        inputTokens: event.usage?.input_tokens ?? null, outputTokens: event.usage?.output_tokens ?? null,
      }) });
    const modelConfig = {
      client: openai, model: env.OPENAI_MODEL, fallbackModel: env.OPENAI_FALLBACK_MODEL,
    };
    const model = createOpenAICompletion(modelConfig);
    const queensModel = createOpenAICompletion({ ...modelConfig, reasoningEffort: 'none' });
    const tools = createTools({ apiKey: env.OWM_API_KEY, queens: createQueensService() });
    const speech = { client: openai,
      model: env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1-mini', voice: env.OPENAI_TTS_VOICE?.trim() || 'coral' };
    const speaker = createCachedSpeaker(createRealtimeSpeaker({ ...speech, connect: connectWorkers, warn: entry => logger.warn(entry) }),
      createR2AudioCache(env.TALK_AUDIO, { warn: entry => logger.warn(entry) }), {
        model: speech.model, voice: speech.voice, promptVersion: REALTIME_SPEECH_PROMPT_VERSION, warn: entry => logger.warn(entry),
      });
    const response = await createApi({
      talk: { tutor: createTutor(model, { log: talkLog }), speaker, transcriber: createOpenAITranscriber({
        client: openai, model: env.OPENAI_TRANSCRIBE_MODEL,
      }), log: talkLog },
      reply: createReply(createGateway(model, tools, createToolLogger(logger))),
      adventure: createGameMaster(model, { temperature: env.ADVENTURE_TEMPERATURE, log: createAdventureLogger(logger) }),
    queens: createQueensGenerator(queensModel, { log: createQueensLogger(logger) }),
    }).fetch(request);
    const body = response.body;
    if (!body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
      await flushUsage();
      return response;
    }
    const reader = body.getReader();
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (!done) { controller.enqueue(value); return; }
        await flushNow();
        controller.close();
      },
      async cancel(reason) {
        await reader.cancel(reason);
        await flushNow();
      },
    }), { status: response.status, headers: response.headers });
  },
};
