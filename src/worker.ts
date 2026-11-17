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
import { createOpenAICompletion } from './infra/openai.ts';
import { createApi } from './ui/http/api.ts';
import { createTutor } from './app/talk/tutor.ts';
import { createOpenAITranscriber } from './infra/openai-transcribe.ts';
import { createTalkLogger } from './infra/talk-logger.ts';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TALK_AUDIO?: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  OPENAI_REALTIME_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  OPENAI_TOOL_MODE?: string;
  OPENAI_BASE_URL?: string;
  OWM_API_KEY?: string;
  LOG_LEVEL?: string;
  ADVENTURE_TEMPERATURE?: string;
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const logger = createConsoleLogger({ level: env.LOG_LEVEL });
    const talkLog = createTalkLogger(logger);
    const createGateway = env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
      : ['json', 'react'].includes(env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
    const modelConfig = {
      model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL,
    };
    const model = createOpenAICompletion(modelConfig);
    const queensModel = createOpenAICompletion({ ...modelConfig, reasoningEffort: 'none' });
    const tools = createTools({ apiKey: env.OWM_API_KEY, queens: createQueensService() });
    const speech = { apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1-mini', voice: env.OPENAI_TTS_VOICE?.trim() || 'coral' };
    const speaker = createCachedSpeaker(createRealtimeSpeaker({ ...speech, connect: connectWorkers, warn: entry => logger.warn(entry) }),
      createR2AudioCache(env.TALK_AUDIO, { warn: entry => logger.warn(entry) }), {
        model: speech.model, voice: speech.voice, promptVersion: REALTIME_SPEECH_PROMPT_VERSION, warn: entry => logger.warn(entry),
      });
    return createApi({
      talk: { tutor: createTutor(model, { log: talkLog }), speaker, transcriber: createOpenAITranscriber({
        apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_TRANSCRIBE_MODEL,
      }), log: talkLog },
      reply: createReply(createGateway(model, tools, createToolLogger(logger))),
      adventure: createGameMaster(model, { temperature: env.ADVENTURE_TEMPERATURE, log: createAdventureLogger(logger) }),
    queens: createQueensGenerator(queensModel, { log: createQueensLogger(logger) }),
    }).fetch(request);
  },
};
