import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { getRequestListener } from '@hono/node-server';
import { createReply } from './src/app/chat.ts';
import { createQueensService } from './src/app/queens/service.ts';
import { createQueensGenerator } from './src/app/queens/generator.ts';
import { createQueensLogger } from './src/infra/queens-logger.ts';
import { createToolChat } from './src/app/tool-chat.ts';
import { createPlanExecuteChat } from './src/app/plan-execute-chat.ts';
import { createFunctionToolChat } from './src/app/function-tool-chat.ts';
import { createTools } from './src/infra/tools.ts';
import { createToolLogger } from './src/infra/tool-logger.ts';
import { createLogger } from './src/infra/logger.ts';
import { createOpenAICompletion } from './src/infra/openai.ts';
import { createApi } from './src/ui/http/api.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['OPENAI_', 'OWM_', 'LOG_']);
  const logger = createLogger({ level: env.LOG_LEVEL });
  const createGateway = env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
    : ['json', 'react'].includes(env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
  const model = createOpenAICompletion({ model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY });
  const tools = createTools({ apiKey: env.OWM_API_KEY, queens: createQueensService() });
  const listener = getRequestListener(createApi({
    reply: createReply(createGateway(model, tools, createToolLogger(logger))),
    queen: createQueensGenerator(model, tools.find(tool => tool.definition.name === 'verify_puzzle')!, createQueensLogger(logger)),
  }).fetch);
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
