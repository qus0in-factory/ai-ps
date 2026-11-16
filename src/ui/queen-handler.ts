import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QueensGenerator } from '../domain/queens/generation.ts';
import { createProblem } from '../app/problem.ts';

export function createQueenHandler(generator: QueensGenerator) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/queen/generate') return next();
    let streaming = false;
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    res.once?.('close', disconnect);
    const frame = (value: unknown) => {
      if (res.destroyed) return;
      if (!streaming) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.statusCode = 200;
        streaming = true;
      }
      res.write(JSON.stringify(value) + '\n');
    };
    const problem = (status: number, detail: string) => {
      const value = createProblem(status, detail, '/api/queen/generate');
      if (streaming) { frame({ type: 'problem', problem: value }); res.end(); }
      else { res.statusCode = status; res.setHeader('Content-Type', 'application/problem+json'); res.end(JSON.stringify(value)); }
    };
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return problem(405, 'POST 요청만 가능합니다.'); }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > 10_000) return problem(413, '요청이 너무 큽니다.');
        chunks.push(bytes);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return problem(400, '올바른 JSON 요청이 필요합니다.'); }
      const size = body && typeof body === 'object' && 'size' in body ? body.size : undefined;
      if (typeof size !== 'number' || !Number.isInteger(size) || size < 5 || size > 9) return problem(400, '크기는 5~9의 정수여야 합니다.');
      const result = await generator.generate(size, event => frame({ type: 'event', event }), controller.signal);
      if (res.destroyed) return;
      if (result.ok) { frame({ type: 'result', value: result.value }); res.end(); }
      else problem(502, result.reason);
    } catch {
      if (!res.destroyed) problem(500, '퍼즐 생성 요청을 처리하지 못했습니다.');
    } finally {
      res.off?.('close', disconnect);
    }
  };
}
