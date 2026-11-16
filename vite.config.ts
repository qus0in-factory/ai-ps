import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { createReply } from './src/app/chat.ts';
import { createToolChat } from './src/app/tool-chat.ts';
import { createFunctionToolChat } from './src/app/function-tool-chat.ts';
import { createTools } from './src/infra/tools.ts';
import { createToolLogger } from './src/infra/tool-logger.ts';
import { createOpenAICompletion } from './src/infra/openai.ts';
import { createChatHandler } from './src/ui/chat-handler.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['OPENAI_', 'OWM_']);
  const createGateway = env.OPENAI_TOOL_MODE === 'json' ? createToolChat : createFunctionToolChat;
  const chat = createChatHandler(createReply(createGateway(createOpenAICompletion({
    model: env.OPENAI_MODEL,
    apiKey: env.OPENAI_API_KEY,
  }), createTools({ apiKey: env.OWM_API_KEY }), createToolLogger())));
  return {
    plugins: [solid(), {
      name: 'chat-api',
      configureServer(server) { server.middlewares.use(chat); },
      configurePreviewServer(server) { server.middlewares.use(chat); },
    }],
  };
});
