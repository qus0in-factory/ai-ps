import { loadEnvFile } from 'node:process';
import { createOpenAIClient, createOpenAICompletion } from './infra/openai.ts';

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
const openai = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL });
const gateway = createGateway(createOpenAICompletion({
  client: openai,
  model: process.env.OPENAI_MODEL,
  fallbackModel: process.env.OPENAI_FALLBACK_MODEL,
}), createTools({ apiKey: process.env.OWM_API_KEY, queens: createQueensService() }), createToolLogger(logger, { full: true }));
const result = await gateway.complete([
  { role: 'user', content: process.argv.slice(2).join(' ') || '안녕하세요!' },
]);
if (result.ok) logger.info({ event: 'answer', chars: result.value.length }, '답변 완료');
else {
  logger.error({ event: 'request_error', reason: result.reason }, '요청 실패');
  process.exitCode = 1;
}
