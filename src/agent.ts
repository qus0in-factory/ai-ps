import { loadEnvFile } from 'node:process';
import { createOpenAICompletion } from './infra/openai.ts';

import { createToolChat } from './app/tool-chat.ts';
import { createFunctionToolChat } from './app/function-tool-chat.ts';
import { createTools } from './infra/tools.ts';
import { createToolLogger } from './infra/tool-logger.ts';

loadEnvFile('.env');
const createGateway = process.env.OPENAI_TOOL_MODE === 'json' ? createToolChat : createFunctionToolChat;
const gateway = createGateway(createOpenAICompletion({
  model: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
}), createTools({ apiKey: process.env.OWM_API_KEY }), createToolLogger());
const result = await gateway.complete([
  { role: 'user', content: process.argv.slice(2).join(' ') || '안녕하세요!' },
]);
if (result.ok) console.log(result.value);
else {
  console.error(result.reason);
  process.exitCode = 1;
}
