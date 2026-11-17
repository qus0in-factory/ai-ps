import type { R2Bucket } from './infra/r2-audio-cache.ts';
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

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TALK_AUDIO?: R2Bucket;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
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
    const createGateway = env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
      : ['json', 'react'].includes(env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
    const modelConfig = {
      model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL,
    };
    const model = createOpenAICompletion(modelConfig);
    const queensModel = createOpenAICompletion({ ...modelConfig, reasoningEffort: 'none' });
    const tools = createTools({ apiKey: env.OWM_API_KEY, queens: createQueensService() });
    return createApi({
      talk: { tutor: createTutor(model) },
      reply: createReply(createGateway(model, tools, createToolLogger(logger))),
      adventure: createGameMaster(model, { temperature: env.ADVENTURE_TEMPERATURE, log: createAdventureLogger(logger) }),
    queens: createQueensGenerator(queensModel, { log: createQueensLogger(logger) }),
    }).fetch(request);
  },
};
