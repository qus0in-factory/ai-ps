import type { GameMaster } from '../../domain/adventure/types.ts';
import { parseAdventureTurn, isAdventureStart } from '../../app/adventure/game-master.ts';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Reply } from '../../app/chat.ts';
import { createProblem } from '../../app/problem.ts';
import type { QueensGenerator } from '../../domain/queens/generation.ts';
import type { Tutor, Reporter } from '../../domain/talk/types.ts';
import { parseTurnRequest, parseReportRequest, type TalkLogListener } from '../../app/talk/tutor.ts';
import type { Transcriber } from '../../domain/talk/transcription.ts';
import { validateTranscriptionAudio } from '../../app/talk/transcribe.ts';
import { parseSpeechRequest } from '../../app/talk/speech.ts';
import type { CachedSpeaker } from '../../domain/talk/speech-cache.ts';

export interface ApiDependencies {
  reply: Reply;
  queens: QueensGenerator;
  adventure: GameMaster;
  talk: { tutor: Tutor & Reporter; transcriber?: Transcriber; speaker?: CachedSpeaker; log?: TalkLogListener };
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
  return new Promise<Response>(resolve => {
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    let done = false;
    const cleanup = () => signal.removeEventListener('abort', cancelIncoming);
    const cancelIncoming = () => {
      if (done) return;
      done = true;
      abort.abort();
      if (sink) sink.close();
      else resolve(problem(502, '요청이 중단되었습니다.', instance));
      cleanup();
    };
    const frame: Frame = value => {
      if (done || abort.signal.aborted) return;
      const bytes = encoder.encode(JSON.stringify(value) + '\n');
      if (!sink) {
        const body = new ReadableStream<Uint8Array>({
          start: controller => { sink = controller; },
          cancel: () => { done = true; abort.abort(); cleanup(); },
        });
        resolve(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' } }));
      }
      sink!.enqueue(bytes);
    };
    const finish = (outcome: Outcome) => {
      if (done) return;
      if (outcome.ok && outcome.json !== undefined && !sink) resolve(Response.json(outcome.json, {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }));
      else if (!outcome.ok && !sink) resolve(problem(outcome.status, outcome.detail, instance));
      else {
        frame(outcome.ok ? outcome.frame : { type: 'problem', problem: createProblem(outcome.status, outcome.detail, instance) });
        sink!.close();
      }
      done = true;
      cleanup();
    };
    signal.addEventListener('abort', cancelIncoming, { once: true });
    if (signal.aborted) { cancelIncoming(); return; }
    const safeFailure = () => {
      if (done) return;
      try {
        if (!sink) resolve(problem(500, failure, instance));
        else sink.enqueue(encoder.encode(JSON.stringify({ type: 'problem', problem: createProblem(500, failure, instance) }) + '\n'));
      } catch { /* The reader may already be disconnected. */ }
      finally {
        try { sink?.close(); } catch { /* Already closed. */ }
        done = true;
        abort.abort();
        cleanup();
      }
    };
    Promise.resolve().then(() => run(frame, abort.signal)).then(finish).catch(safeFailure);
  });
}

export function createApi({ reply, queens, adventure, talk }: ApiDependencies) {
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

  api.post('/api/queens/generate', limit(10_000, '요청이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', '/api/queens/generate');
    const size = body.value && typeof body.value === 'object' && 'size' in body.value ? body.value.size : undefined;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 5 || size > 9) {
      return problem(400, '크기는 5~9의 정수여야 합니다.', '/api/queens/generate');
    }
    return progress('/api/queens/generate', '퍼즐 생성 요청을 처리하지 못했습니다.', c.req.raw.signal, async (frame, signal) => {
      const result = await queens.generate(size, event => frame({ type: 'event', event }), signal);
      return result.ok ? { ok: true, frame: { type: 'result', value: result.value } } : { ok: false, status: 502, detail: result.reason };
    });
  });
  postOnly('/api/queens/generate');

  api.post('/api/adventure/start', limit(1_000, '요청이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok || !isAdventureStart(body.value)) return problem(400, '시작 요청은 빈 JSON 객체여야 합니다.', '/api/adventure/start');
    return progress('/api/adventure/start', '모험을 시작하지 못했습니다.', c.req.raw.signal, async (frame, signal) => {
      const result = await adventure.start(event => frame({ type: 'event', event }), signal);
      return result.ok ? { ok: true, frame: { type: 'result', value: result.value } } : { ok: false, status: 502, detail: result.reason };
    });
  });
  postOnly('/api/adventure/start');
  api.post('/api/adventure/turn', limit(32_000, '요청이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', '/api/adventure/turn');
    const input = parseAdventureTurn(body.value);
    if (!input.ok) return problem(400, input.reason, '/api/adventure/turn');
    return progress('/api/adventure/turn', '모험 요청을 처리하지 못했습니다.', c.req.raw.signal, async (frame, signal) => {
      const result = await adventure.turn(input.value.session, input.value.action, event => frame({ type: 'event', event }), signal);
      return result.ok ? { ok: true, frame: { type: 'result', value: result.value } } : { ok: false, status: 502, detail: result.reason };
    });
  });
  postOnly('/api/adventure/turn');

  api.post('/api/talk/transcribe', limit(2_500_000, '음성 요청이 너무 큽니다.'), async c => {
    let form: FormData;
    try {
      if (!c.req.header('Content-Type')?.toLowerCase().startsWith('multipart/form-data;')) {
        return problem(400, '멀티파트 음성 파일이 필요합니다.', c.req.path);
      }
      form = await c.req.raw.formData();
    } catch { return problem(400, '올바른 멀티파트 요청이 필요합니다.', c.req.path); }
    const entries = [...form.entries()];
    if (entries.length !== 1 || entries[0]![0] !== 'audio') return problem(400, 'audio 파일 하나만 필요합니다.', c.req.path);
    const input = validateTranscriptionAudio(entries[0]![1]);
    if (!input.ok) return problem(input.status, input.reason, c.req.path);
    if (!talk.transcriber) return problem(502, '음성 인식 서비스를 사용할 수 없습니다.', c.req.path);
    const started = Date.now();
    const result = await talk.transcriber.transcribe(input.value, c.req.raw.signal);
    talk.log?.({ event: 'transcribe', ok: result.ok, ms: Date.now() - started, inputBytes: input.value.size, outputChars: result.ok ? result.value.length : undefined });
    return result.ok ? c.json({ text: result.value }, 200, { 'Cache-Control': 'no-store' })
      : problem(502, '음성을 인식하지 못했습니다. 잠시 후 다시 시도해주세요.', c.req.path);
  });
  postOnly('/api/talk/transcribe');

  api.post('/api/talk/speech', limit(4_000, '음성 입력이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', c.req.path);
    const input = parseSpeechRequest(body.value);
    if (!input.ok) return problem(400, input.reason, c.req.path);
    const started = Date.now();
    let result: Awaited<ReturnType<CachedSpeaker['speak']>>;
    try {
      result = talk.speaker ? await talk.speaker.speak(input.value, c.req.raw.signal)
        : { ok: false, reason: '음성 서비스를 사용할 수 없습니다.' };
    } catch { result = { ok: false, reason: '음성을 만들지 못했습니다.' }; }
    try {
      talk.log?.({ event: 'speech', ok: result.ok, ms: Date.now() - started, inputChars: [...input.value].length,
        ...(result.ok ? { cache: result.value.cache, outputBytes: result.value.bytes.byteLength } : {}) });
    } catch { /* Logging must not discard generated speech. */ }
    return result.ok ? new Response(Uint8Array.from(result.value.bytes).buffer, {
      headers: { 'Content-Type': 'audio/wav', 'X-Talk-Cache': result.value.cache, 'Cache-Control': 'private, max-age=86400' },
    }) : problem(502, '음성을 만들지 못했습니다. 잠시 후 다시 시도해주세요.', c.req.path);
  });
  postOnly('/api/talk/speech');

  api.post('/api/talk/turn', limit(64_000, '대화 기록이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', c.req.path);
    const input = parseTurnRequest(body.value);
    if (!input.ok) return problem(400, input.reason, c.req.path);
    const result = await talk.tutor.respond(input.value.session, input.value.text, c.req.raw.signal);
    return result.ok ? c.json(result.value, 200, { 'Cache-Control': 'no-store' }) : problem(502, result.reason, c.req.path);
  });
  postOnly('/api/talk/turn');
  api.post('/api/talk/report', limit(64_000, '대화 기록이 너무 큽니다.'), async c => {
    const body = await readJson(c.req.raw);
    if (!body.ok) return problem(400, '올바른 JSON 요청이 필요합니다.', c.req.path);
    const input = parseReportRequest(body.value);
    if (!input.ok) return problem(400, input.reason, c.req.path);
    const result = await talk.tutor.report(input.value, c.req.raw.signal);
    return result.ok ? c.json({ report: result.value }, 200, { 'Cache-Control': 'no-store' }) : problem(502, result.reason, c.req.path);
  });
  postOnly('/api/talk/report');

  api.notFound(c => problem(404, '요청한 API를 찾을 수 없습니다.', c.req.path));
  api.onError((_error, c) => problem(500, '요청을 처리하지 못했습니다.', c.req.path));
  return api;
}
