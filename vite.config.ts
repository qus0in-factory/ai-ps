import { createGameMaster } from './src/app/adventure/game-master.ts';
import { createAdventureLogger } from './src/infra/adventure-logger.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { getRequestListener } from '@hono/node-server';
import { createReply } from './src/app/chat.ts';
import { createHistoryCompactor } from './src/app/history-compactor.ts';
import { createQueensService } from './src/app/queens/service.ts';
import { createQueensGenerator } from './src/app/queens/generator.ts';
import { createQueensLogger } from './src/infra/queens-logger.ts';
import { createToolChat } from './src/app/tool-chat.ts';
import { createPlanExecuteChat } from './src/app/plan-execute-chat.ts';
import { createFunctionToolChat } from './src/app/function-tool-chat.ts';
import { createTools } from './src/infra/tools.ts';
import { createToolLogger } from './src/infra/tool-logger.ts';
import { createLogger } from './src/infra/logger.ts';
import { createOpenAICompletion, DEFAULT_FALLBACK_MODEL } from './src/infra/openai.ts';
import { createApi } from './src/ui/http/api.ts';
import { createTutor } from './src/app/talk/tutor.ts';
import { createOpenAITranscriber } from './src/infra/openai-transcribe.ts';
import { createTalkLogger } from './src/infra/talk-logger.ts';
import { createCachedSpeaker } from './src/app/talk/cached-speaker.ts';
import { createMemoryAudioCache } from './src/infra/memory-audio-cache.ts';
import { createRealtimeSpeaker, REALTIME_SPEECH_PROMPT_VERSION } from './src/infra/openai-realtime-speech.ts';
import { connectNodeRealtime } from './src/infra/node-realtime-connect.ts';
import { createResearchEndpoint } from './src/worker.ts';
import { getPath } from 'hono/utils/url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['OPENAI_', 'OWM_', 'LOG_', 'ADVENTURE_', 'BRAVE_', 'BRAVE-', 'NCP_', 'X-NCP-']);
  const logger = createLogger({ level: env.LOG_LEVEL });
  const talkLog = createTalkLogger(logger);
  const createGateway = env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
    : ['json', 'react'].includes(env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
  const modelConfig = { model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL };
  const model = createOpenAICompletion(modelConfig);
  const chatModel = createOpenAICompletion({ ...modelConfig, routing: { complexModel: env.OPENAI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL, keys: ['ai-ps:chatPlan', 'ai-ps:chatAnswer'] } });
  const queensModel = createOpenAICompletion({ ...modelConfig, reasoningEffort: 'none' });
  const tools = createTools({ apiKey: env.OWM_API_KEY, queens: createQueensService() });
  const speech = { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL,
    model: env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1-mini', voice: env.OPENAI_TTS_VOICE?.trim() || 'coral' };
  const speaker = createCachedSpeaker(createRealtimeSpeaker({ ...speech, connect: connectNodeRealtime, warn: entry => logger.warn(entry) }),
    createMemoryAudioCache(), { model: speech.model, voice: speech.voice, promptVersion: REALTIME_SPEECH_PROMPT_VERSION, warn: entry => logger.warn(entry) });
  const existingApi = createApi({
    talk: { tutor: createTutor(model, { log: talkLog }), speaker, transcriber: createOpenAITranscriber({
      apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_TRANSCRIBE_MODEL,
    }), log: talkLog },
    reply: createReply(createGateway(chatModel, tools, createToolLogger(logger, { full: true })), createHistoryCompactor(model)),
    adventure: createGameMaster(model, { temperature: env.ADVENTURE_TEMPERATURE, log: createAdventureLogger(logger) }),
    queens: createQueensGenerator(queensModel, { log: createQueensLogger(logger) }),
  });
  const research = createResearchEndpoint({ OPENAI_MODEL: env.OPENAI_MODEL, OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL, BRAVE_SEARCH_API_KEY: env.BRAVE_SEARCH_API_KEY?.trim() || env['BRAVE-SEARCH-API-KEY'],
    NCP_API_KEY_ID: env.NCP_API_KEY_ID?.trim() || env['X-NCP-APIGW-API-KEY-ID'],
    NCP_API_KEY: env.NCP_API_KEY?.trim() || env['X-NCP-APIGW-API-KEY'],
  }, { log: metrics => logger.info(metrics) });
  const listener = getRequestListener(request => getPath(request) === '/api/research' ? research.fetch(request) : existingApi.fetch(request));
  const api = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0].startsWith('/api/')) listener(req, res);
    else next();
  };
  return {
    plugins: [solid(), {
      name: 'hono-api',
      configureServer(server) { server.middlewares.use(api); },
      configurePreviewServer(server) { server.middlewares.use(api); },
    }],
  };
});
