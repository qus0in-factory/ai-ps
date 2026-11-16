import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { createReply } from './src/app/chat.ts';
import { createQueensService } from './src/app/queens/service.ts';
import { createQueensGenerator } from './src/app/queens/generator.ts';
import { createQueenHandler } from './src/ui/queen-handler.ts';
import { createQueensLogger } from './src/infra/queens-logger.ts';
import { createToolChat } from './src/app/tool-chat.ts';
import { createPlanExecuteChat } from './src/app/plan-execute-chat.ts';
import { createFunctionToolChat } from './src/app/function-tool-chat.ts';
import { createTools } from './src/infra/tools.ts';
import { createToolLogger } from './src/infra/tool-logger.ts';
import { createLogger } from './src/infra/logger.ts';
import { createOpenAICompletion } from './src/infra/openai.ts';
import { createChatHandler } from './src/ui/chat-handler.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['OPENAI_', 'OWM_', 'LOG_']);
  const logger = createLogger({ level: env.LOG_LEVEL });
  const createGateway = env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
    : ['json', 'react'].includes(env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
  const model = createOpenAICompletion({ model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY });
  const tools = createTools({ apiKey: env.OWM_API_KEY, queens: createQueensService() });
  const chat = createChatHandler(createReply(createGateway(model, tools, createToolLogger(logger))));
  const queen = createQueenHandler(createQueensGenerator(model, tools.find(tool => tool.definition.name === 'verify_puzzle')!, createQueensLogger(logger)));
  return {
    plugins: [solid(), {
      name: 'chat-api',
      configureServer(server) { server.middlewares.use(queen); server.middlewares.use(chat); },
      configurePreviewServer(server) { server.middlewares.use(queen); server.middlewares.use(chat); },
    }],
  };
});
