import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Reply } from '../app/chat.ts';
import { createProblem } from '../app/problem.ts';

export function createChatHandler(reply: Reply) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/chat') return next();
    const wantsStream = req.headers?.accept?.includes('application/x-ndjson');
    let streaming = false;
    const frame = (data: unknown) => {
      if (!streaming) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        streaming = true;
      }
      res.write(JSON.stringify(data) + '\n');
    };
    const respond = (status: number, data: unknown) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    const problem = (status: number, detail: string) => {
      if (streaming) {
        frame({ type: 'problem', problem: createProblem(status, detail, '/api/chat') });
        res.end();
        return;
      }
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/problem+json');
      res.end(JSON.stringify(createProblem(status, detail, '/api/chat')));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return problem(405, 'POST 요청만 가능합니다.');
    }
    let body: unknown;
    try {
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 100_000) return problem(413, '메시지가 너무 깁니다.');
      }
      body = JSON.parse(text);
    } catch {
      return problem(400, '올바른 JSON 요청이 필요합니다.');
    }
    try {
      const result = await reply(body, wantsStream ? (step) => frame({ type: 'step', step }) : undefined);
      if (result.ok && wantsStream) {
        frame({ type: 'result', content: result.value });
        res.end();
      } else if (result.ok) respond(200, { content: result.value });
      else problem(result.status, result.reason);
    } catch {
      problem(500, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  };
}
