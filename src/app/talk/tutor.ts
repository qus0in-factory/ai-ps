import type { CompletionGateway, JsonSchemaResponseFormat } from '../../domain/completion.ts';
import type { Result } from '../../domain/chat.ts';
import type { TalkSession, Tutor, Reporter } from '../../domain/talk/types.ts';
import type { TalkLogEntry, TalkLogListener } from '../../domain/talk/logging.ts';
export type { TalkLogEntry, TalkLogListener } from '../../domain/talk/logging.ts';
import { normalizeSession, record, only, text, canAddTurn, LIMITS } from '../../domain/talk/session.ts';
import { TALK_FIXED_PHRASES } from '../../domain/talk/speech-cache.ts';
import { parseTutorReply } from '../../domain/talk/reply.ts';
import { buildTutorMessages, buildReportMessages } from '../../domain/talk/prompt.ts';

const TUTOR_REPLY_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'tutor_reply',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: ['neutral', 'smile', 'think', 'surprised', 'encourage', 'confused'] },
        reply: { type: 'string' },
        correction: { type: ['string', 'null'] },
        betterExpression: { type: ['string', 'null'] },
      },
      required: ['mood', 'reply', 'correction', 'betterExpression'],
      additionalProperties: false,
    },
  },
};

export function parseTurnRequest(body: unknown): Result<{ session: TalkSession; text?: string }> {
  if (!record(body) || !only(body, ['session','text'])) return { ok: false, reason: '올바른 세션과 텍스트가 필요합니다.' };
  const session = normalizeSession(body.session);
  if (!session || (body.text !== undefined && (typeof body.text !== 'string' || !text(body.text.trim(), LIMITS.learner)))) {
    return { ok: false, reason: '올바른 세션과 1~500자의 텍스트가 필요합니다.' };
  }
  const learner = typeof body.text === 'string' ? body.text.trim() : undefined;
  if (learner === undefined && session.turns.length) return { ok: false, reason: '대화를 이어갈 텍스트를 입력하세요.' };
  if (!canAddTurn(session, learner)) return { ok: false, reason: '대화 기록 한도에 도달했습니다. 연습을 마치고 보고서를 받으세요.' };
  return { ok: true, value: { session, ...(learner === undefined ? {} : { text: learner }) } };
}
export function parseReportRequest(body: unknown): Result<TalkSession> {
  const session = record(body) && only(body, ['session']) ? normalizeSession(body.session) : undefined;
  return session?.turns.length ? { ok: true, value: session } : { ok: false, reason: '보고서를 만들 대화 기록이 필요합니다.' };
}
export function createTutor(model: CompletionGateway, options: { log?: TalkLogListener } = {}): Tutor & Reporter {
  const log = options.log;
  async function request(messages: Parameters<CompletionGateway['complete']>[0], json: boolean, external?: AbortSignal) {
    const timeout = AbortSignal.timeout(60_000);
    const signal = external ? AbortSignal.any([external, timeout]) : timeout;
    const cancelled = () => ({ ok: false as const, reason: '요청이 중단되었거나 시간이 초과되었습니다.' });
    if (signal.aborted) return cancelled();
    let cancel: (() => void) | undefined;
    try {
      const aborted = new Promise<ReturnType<typeof cancelled>>(resolve => {
        cancel = () => resolve(cancelled()); signal.addEventListener('abort', cancel, { once: true });
      });
      const result = await Promise.race([model.complete(messages, {
        reasoning_effort: 'none', max_completion_tokens: 800, signal,
        ...(json ? { response_format: TUTOR_REPLY_FORMAT } : {}),
      }), aborted]);
      if (signal.aborted) return cancelled();
      if (!result.ok) return { ok: false as const, reason: '회화 응답을 가져오지 못했습니다. 다시 시도해 주세요.' };
      return result;
    } catch { return { ok: false as const, reason: '회화 응답을 가져오지 못했습니다. 다시 시도해 주세요.' }; }
    finally { if (cancel) signal.removeEventListener('abort', cancel); }
  }
  return {
    async respond(session, learner, signal) {
      const started = Date.now();
      const input = parseTurnRequest({ session, ...(learner === undefined ? {} : { text: learner }) });
      if (!input.ok) {
        log?.({ event: 'turn', ok: false, ms: Date.now() - started, turns: 0, learnerChars: learner?.trim().length });
        return input;
      }
      const turns = input.value.session.turns.length;
      const learnerChars = input.value.text?.length ?? 0;
      if (input.value.text === undefined) {
        log?.({ event: 'turn', ok: true, ms: Date.now() - started, turns, learnerChars, replyChars: TALK_FIXED_PHRASES.greeting.length });
        return { ok: true, value: { mood: 'smile', reply: TALK_FIXED_PHRASES.greeting, correction: null, betterExpression: null } };
      }
      const result = await request(buildTutorMessages(input.value.session, input.value.text), true, signal);
      if (!result.ok) {
        log?.({ event: 'turn', ok: false, ms: Date.now() - started, turns, learnerChars });
        return result;
      }
      const value = parseTutorReply(result.value.content ?? '');
      log?.({ event: 'turn', ok: true, ms: Date.now() - started, turns, learnerChars, replyChars: value.reply.length });
      return { ok: true, value };
    },
    async report(session, signal) {
      const started = Date.now();
      const input = parseReportRequest({ session });
      if (!input.ok) {
        log?.({ event: 'report', ok: false, ms: Date.now() - started, turns: 0 });
        return input;
      }
      const turns = input.value.turns.length;
      const result = await request(buildReportMessages(input.value), false, signal);
      if (!result.ok) {
        log?.({ event: 'report', ok: false, ms: Date.now() - started, turns });
        return result;
      }
      const content = result.value.content;
      if (typeof content !== 'string' || !content.trim()) {
        log?.({ event: 'report', ok: false, ms: Date.now() - started, turns });
        return { ok: false, reason: '보고서를 받지 못했습니다. 다시 시도해 주세요.' };
      }
      const report = content.trim().slice(0, LIMITS.report).trim();
      log?.({ event: 'report', ok: true, ms: Date.now() - started, turns, reportChars: report.length });
      return { ok: true, value: report };
    },
  };
}
