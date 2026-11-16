import { defineConfig, loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { createReply } from './src/app/chat.ts';
import { createOpenAIChat } from './src/infra/openai.ts';
import { createChatHandler } from './src/ui/chat-handler.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'OPENAI_');
  const chat = createChatHandler(createReply(createOpenAIChat({
    model: env.OPENAI_MODEL,
    apiKey: env.OPENAI_API_KEY,
  })));
  return {
    plugins: [solid(), {
      name: 'chat-api',
      configureServer(server) { server.middlewares.use(chat); },
      configurePreviewServer(server) { server.middlewares.use(chat); },
    }],
  };
});
