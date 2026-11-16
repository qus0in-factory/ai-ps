import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Reply } from '../../app/chat.ts';
import { createProblem } from '../../app/problem.ts';
import type { QueensGenerator } from '../../domain/queens/generation.ts';

export interface ApiDependencies {
  reply: Reply;
  queen: QueensGenerator;
}

type Outcome = { ok: true; frame: unknown; json?: unknown } | { ok: false; status: number; detail: string };
type Frame = (value: unknown) => void;

const encoder = new TextEncoder();

function problem(status: number, detail: string, instance: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(createProblem(status, detail, instance)), {
    status, headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try { return { ok: true, value: JSON.parse(await request.text()) }; }
  catch { return { ok: false }; }
}

// NDJSON은 첫 프레임에서 시작한다. 그 전에 끝난 실패는 일반 Problem Details 응답으로 보낸다.
function progress(instance: string, failure: string, signal: AbortSignal, run: (frame: Frame, signal: AbortSignal) => Promise<Outcome>) {
  const abort = new AbortController();
  signal.addEventListener('abort', () => abort.abort(), { once: true });
  return new Promise<Response>(resolve => {
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    const frame: Frame = value => {
      if (abort.signal.aborted) return;
      if (!sink) {
        const body = new ReadableStream<Uint8Array>({ start: controller => { sink = controller; }, cancel: () => abort.abort() });
        resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' } }));
      }
      sink!.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
    };
    const finish = (outcome: Outcome) => {
      if (outcome.ok && outcome.json !== undefined && !sink) return resolve(Response.json(outcome.json, {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
      if (!outcome.ok && !sink) return resolve(problem(outcome.status, outcome.detail, instance));
      frame(outcome.ok ? outcome.frame : { type: 'problem', problem: createProblem(outcome.status, outcome.detail, instance) });
      if (!abort.signal.aborted) sink!.close();
    };
    run(frame, abort.signal)
      .catch((): Outcome => ({ ok: false, status: 500, detail: failure }))
      .then(finish);
  });
}

export function createApi({ reply, queen }: ApiDependencies) {
  const api = new Hono();
  const limit = (maxSize: number, detail: string) => bodyLimit({ maxSize, onError: c => problem(413, detail, c.req.path) });
  const postOnly = (path: string) => api.all(path, () => problem(405, 'POST 요청만 가능합니다.', path, { Allow: 'POST' }));

  api.post('/api/chat', limit(100_000, '메시지가 너무 깁니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', '/api/chat');
    const wantsStream = c.req.header('Accept')?.includes('application/x-ndjson') ?? false;
    return progress('/api/chat', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', c.req.raw.signal, async frame => {
      const result = await reply(body.value, wantsStream ? step => frame({ type: 'step', step }) : undefined);
      return result.ok
        ? { ok: true, frame: { type: 'result', content: result.value }, json: wantsStream ? undefined : { content: result.value } }
        : { ok: false, status: result.status, detail: result.reason };
    });
  });
  postOnly('/api/chat');

  api.post('/api/queen/generate', limit(10_000, '요청이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', '/api/queen/generate');
    const size = body.value && typeof body.value === 'object' && 'size' in body.value ? body.value.size : undefined;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 5 || size > 9) {
      return problem(400, '크기는 5~9의 정수여야 합니다.', '/api/queen/generate');
    }
    return progress('/api/queen/generate', '퍼즐 생성 요청을 처리하지 못했습니다.', c.req.raw.signal, async (frame, signal) => {
      const result = await queen.generate(size, event => frame({ type: 'event', event }), signal);
      return result.ok ? { ok: true, frame: { type: 'result', value: result.value } } : { ok: false, status: 502, detail: result.reason };
    });
  });
  postOnly('/api/queen/generate');

  api.notFound(c => problem(404, '요청한 API를 찾을 수 없습니다.', c.req.path));
  api.onError((_error, c) => problem(500, '요청을 처리하지 못했습니다.', c.req.path));
  return api;
}
