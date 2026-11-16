import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Reply } from '../app/chat.ts';

export function createChatHandler(reply: Reply) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/chat') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const respond = (status: number, data: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return respond(405, { error: 'POST 요청만 가능합니다.' });
    }
    let body: unknown;
    try {
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 100_000) return respond(413, { error: '메시지가 너무 깁니다.' });
      }
      body = JSON.parse(text);
    } catch {
      return respond(400, { error: '올바른 JSON 요청이 필요합니다.' });
    }
    const result = await reply(body);
    if (result.ok) respond(200, { content: result.value });
    else respond(result.status, { error: result.reason });
  };
}
