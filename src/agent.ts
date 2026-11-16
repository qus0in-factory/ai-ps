import { loadEnvFile } from 'node:process';
import { createOpenAIChat } from './infra/openai.ts';

loadEnvFile('.env');
const gateway = createOpenAIChat({
  model: process.env.OPENAI_MODEL,
  apiKey: process.env.OPENAI_API_KEY,
});
const result = await gateway.complete([
  { role: 'user', content: process.argv.slice(2).join(' ') || '안녕하세요!' },
]);
if (result.ok) console.log(result.value);
else {
  console.error(result.reason);
  process.exitCode = 1;
}
