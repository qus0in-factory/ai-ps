import type { FunctionCompletionGateway, CompletionMessage, CompletionOptions, JsonSchemaResponseFormat } from '../../domain/completion.ts';
import type { Result } from '../../domain/chat.ts';
import type { AdventureSession, AdventureListener, GameMaster } from '../../domain/adventure/types.ts';
import type { AdventureLogListener } from '../../domain/adventure/logging.ts';
import { createSession, normalizeSession, MAX_TURNS, LOCATIONS, TIMES, WEATHER, PARTS, record, text } from '../../domain/adventure/session.ts';
import { buildTurnMessages, trimHistory, splitForSummary, buildSummaryMessages, applySummary } from '../../domain/adventure/history.ts';
import { parseTurnOutcome } from '../../domain/adventure/outcome.ts';
import { applyTurn } from '../../domain/adventure/rules.ts';
import { DICE_TOOL, rollDice } from '../../domain/adventure/dice.ts';

const TURN_OUTCOME_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'adventure_turn_outcome',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        narrative: { type: 'string' },
        statChanges: {
          type: 'object',
          properties: {
            health: { type: 'integer' },
            warmth: { type: 'integer' },
            focus: { type: 'integer' },
          },
          required: ['health', 'warmth', 'focus'],
          additionalProperties: false,
        },
        addItems: { type: 'array', items: { type: 'string' } },
        removeItems: { type: 'array', items: { type: 'string' } },
        day: { type: ['integer', 'null'] },
        location: { type: ['string', 'null'], enum: [...LOCATIONS, null] },
        time: { type: ['string', 'null'], enum: [...TIMES, null] },
        weather: { type: ['string', 'null'], enum: [...WEATHER, null] },
        repaired: { type: ['array', 'null'], items: { type: 'string', enum: [...PARTS] } },
        sleep: { type: ['boolean', 'null'] },
        lampLit: { type: ['boolean', 'null'] },
      },
      required: ['narrative', 'statChanges', 'addItems', 'removeItems', 'day', 'location', 'time', 'weather', 'repaired', 'sleep', 'lampLit'],
      additionalProperties: false,
    },
  },
};

const NULLABLE_OUTCOME_KEYS = ['day', 'location', 'time', 'weather', 'repaired', 'sleep', 'lampLit'] as const;

function normalizeOutcome(content: string): string {
  try {
    const value: unknown = JSON.parse(content);
    if (!record(value)) return content;
    for (const key of NULLABLE_OUTCOME_KEYS) if (value[key] === null) delete value[key];
    return JSON.stringify(value);
  } catch {
    return content;
  }
}

export function parseAdventureTurn(body: unknown): Result<{ session: AdventureSession; action: string }> {
  const session = record(body) ? normalizeSession(body.session) : undefined;
  if (!record(body) || Object.keys(body).some(key => !['session','action'].includes(key)) || !session || session.turn >= MAX_TURNS || !(typeof body.action === 'string' && text(body.action.trim(), 200))) return { ok: false, reason: '올바른 세션과 1~200자의 행동이 필요합니다.' };
  if (session.state.ending) return { ok: false, reason: '게임이 끝났습니다. 새 게임을 시작하세요.' };
  return { ok: true, value: { session, action: body.action.trim() } };
}
export function isAdventureStart(body: unknown): boolean { return record(body) && Object.keys(body).length === 0; }
export function createGameMaster(model: FunctionCompletionGateway, { random = Math.random, log, temperature }: {
  random?: () => number; log?: AdventureLogListener; temperature?: number | string;
} = {}): GameMaster {
  const numericTemperature = typeof temperature === 'string' ? (temperature.trim() ? Number(temperature) : undefined) : temperature;
  const temp = numericTemperature !== undefined && Number.isFinite(numericTemperature) && numericTemperature >= 0 && numericTemperature <= 2 ? numericTemperature : undefined;
  const cancelled = () => ({ ok: false as const, reason: '모험 요청이 중단되었습니다.' });
  const deadline = (signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(90_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };
  async function request(messages: CompletionMessage[], signal?: AbortSignal, tools = [DICE_TOOL], summarize = false) {
    if (signal?.aborted) return cancelled();
    let cancel: (() => void) | undefined;
    try {
      const aborted = new Promise<ReturnType<typeof cancelled>>(resolve => {
        cancel = () => resolve(cancelled());
        signal?.addEventListener('abort', cancel, { once: true });
      });
      const options: CompletionOptions = summarize
        ? { max_completion_tokens: 400, reasoning_effort: 'none', ...(temp === undefined ? {} : { temperature: 0.3 }) }
        : { max_completion_tokens: 1600, response_format: TURN_OUTCOME_FORMAT, ...(temp === undefined ? {} : { temperature: temp }) };
      const result = await Promise.race([model.complete(messages, tools, { ...options, ...(tools.length ? { parallel_tool_calls: false } : {}), signal }), aborted]);
      if (result.ok && (typeof result.value.content === 'string' && result.value.content.length > 16_000)) return { ok: false as const, reason: '모험 응답 크기 제한을 초과했습니다.' };
      return result;
    } catch { return { ok: false as const, reason: '모험 응답을 가져오지 못했습니다.' }; }
    finally { if (cancel) signal?.removeEventListener('abort', cancel); }
  }

  return {
    async start(onEvent, signal) {
      signal = deadline(signal);
      const session = createSession();
      log?.({ event: 'model_request', turn: 0 });
      const response = await request(buildTurnMessages(session, '상태를 바꾸지 말고 첫 장면만 묘사하라.'), signal, []);
      if (signal?.aborted) return cancelled();
      if (!response.ok) { log?.({ event: 'model_error', turn: 0 }); return response; }
      const parsed = parseTurnOutcome(normalizeOutcome(response.value.content ?? ''));
      if (!parsed.ok) return parsed;
      onEvent?.({ kind: 'narrative', text: parsed.value.narrative });
      onEvent?.({ kind: 'state', state: session.state, applied: { stats: { health: 0, warmth: 0, focus: 0 }, added: [], removed: [], repaired: [], slept: false } });
      log?.({ event: 'turn_complete', turn: 0, narrativeLength: parsed.value.narrative.length });
      return { ok: true, value: session };
    },
    async turn(session, action, onEvent, signal) {
      const input = parseAdventureTurn({ session, action });
      if (!input.ok) return input;
      if (signal?.aborted) return cancelled();
      session = input.value.session;
      action = input.value.action;
      signal = deadline(signal);
      onEvent?.({ kind: 'accepted', action });
      const messages = buildTurnMessages(session, action);
      let content = '';
      for (let round = 0; round <= 3; round++) {
        log?.({ event: 'model_request', turn: session.turn + 1, round });
        const response = await request(messages, signal);
        if (signal?.aborted) return cancelled();
        if (!response.ok) { log?.({ event: 'model_error', turn: session.turn + 1 }); return response; }
        content = response.value.content ?? '';
        if (!response.value.tool_calls?.length || round === 3) break;
        const calls = response.value.tool_calls.slice(0, 2).filter(call => call && text(call.id, 80) && call.function && text(call.function.name, 64) && text(call.function.arguments, 512));
        messages.push({ role: 'assistant', content: response.value.content, tool_calls: calls });
        for (const call of calls) {
          let output: ReturnType<typeof rollDice> = { ok: false, reason: '등록되지 않았거나 한도 밖인 도구 요청입니다.' };
          if (call.function.name === 'roll_dice') {
            try {
              const args: unknown = JSON.parse(call.function.arguments);
              if (record(args)) output = rollDice(args.sides, args.difficulty, random);
            } catch { output = { ok: false, reason: '주사위 인수는 올바른 JSON 객체여야 합니다.' }; }
          }
          if (output.ok) { onEvent?.({ kind: 'dice', ...output.value }); log?.({ event: 'dice', turn: session.turn + 1, round }); }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
        }
      }
      const parsed = parseTurnOutcome(normalizeOutcome(content));
      if (!parsed.ok) { onEvent?.({ kind: 'invalid', reason: parsed.reason }); log?.({ event: 'invalid', turn: session.turn + 1 }); return { ok: true, value: { ...session, turn: session.turn + 1 } }; }
      const { state, applied } = applyTurn(session.state, parsed.value);
      onEvent?.({ kind: 'narrative', text: parsed.value.narrative });
      onEvent?.({ kind: 'state', state, applied });
      if (state.ending) onEvent?.({ kind: 'ending', ending: state.ending, day: state.day });
      let updated: AdventureSession = { ...session, state, turn: session.turn + 1,
        recent: [...session.recent, { action, narrative: parsed.value.narrative.slice(0,400) }],
      };
      const split = splitForSummary(updated);
      if (split) {
        const response = await request(buildSummaryMessages(updated.summary, split.old), signal, [], true);
        const summary = response.ok && typeof response.value.content === 'string' ? response.value.content.trim() : undefined;
        updated = applySummary(updated, summary);
        log?.({ event: summary ? 'summary' : 'summary_error', turn: updated.turn });
      } else updated = trimHistory(updated);
      log?.({ event: 'turn_complete', turn: updated.turn, narrativeLength: parsed.value.narrative.length });
      return { ok: true, value: updated };
    },
  };
}
