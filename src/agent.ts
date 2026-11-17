import { loadEnvFile } from 'node:process';
import { createOpenAICompletion } from './infra/openai.ts';

import { createToolChat } from './app/tool-chat.ts';
import { createPlanExecuteChat } from './app/plan-execute-chat.ts';
import { createFunctionToolChat } from './app/function-tool-chat.ts';
import { createTools } from './infra/tools.ts';
import { createQueensService } from './app/queens/service.ts';
import { createToolLogger } from './infra/tool-logger.ts';
import { createLogger } from './infra/logger.ts';

loadEnvFile('.env');
const logger = createLogger();
const createGateway = process.env.OPENAI_TOOL_MODE === 'function' ? createFunctionToolChat
    : ['json', 'react'].includes(process.env.OPENAI_TOOL_MODE ?? '') ? createToolChat : createPlanExecuteChat;
const gateway = createGateway(createOpenAICompletion({
  model: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
}), createTools({ apiKey: process.env.OWM_API_KEY, queens: createQueensService() }), createToolLogger(logger));
const result = await gateway.complete([
  { role: 'user', content: process.argv.slice(2).join(' ') || '안녕하세요!' },
]);
if (result.ok) logger.info({ event: 'answer', content: result.value }, '답변 완료');
else {
  logger.error({ event: 'request_error', reason: result.reason }, '요청 실패');
  process.exitCode = 1;
}
