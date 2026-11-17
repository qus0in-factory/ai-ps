import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueensGenerator } from '../../../src/app/queens/generator.ts';
import { isGenerationEvent, type GenerationEvent } from '../../../src/domain/queens/generation.ts';
import { validateDesign } from '../../../src/domain/queens/design.ts';
import type { ChatMessage } from '../../../src/domain/chat.ts';
import type { CompletionOptions } from '../../../src/domain/completion.ts';

const solution = [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
const place = () => solution;
const unique = [[0,0,1,1,1], [1,1,1,1,2], [1,1,2,2,2], [3,3,3,2,4], [3,3,3,4,4]];
const stuck = [[0,0,1,1,1], [0,1,1,2,2], [0,3,2,2,2], [3,3,4,4,2], [3,4,4,4,4]];
const answer = (content: string) => ({ ok: true as const, value: { role: 'assistant' as const, content } });
const timeoutReason = '퍼즐 생성 제한 시간(290초)을 초과했습니다.';

describe('Given algorithmic Queens generation with one optional model proposal', () => {
  it('When direct uniqueness repair fails Then completes from retained model seeds', async () => {
    const events: GenerationEvent[] = [];
    const result = await createQueensGenerator({ complete: async () => answer(JSON.stringify({ regions: stuck })) },
      { place, random: () => 0.5 }).generate(5, event => events.push(event));
    assert.equal(result.ok, true);
    assert.ok(events.some(event => event.kind === 'model' && event.path === 'model-seed'));
    assert.doesNotMatch(JSON.stringify(events), /"row"|"column"|"solution"|"regions"/);
  });
  it('When model seeds retain no nonqueen cells Then falls back without falsely claiming model influence', async () => {
    const regions = Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, column) => (row + column) % 2));
    const events: GenerationEvent[] = [];
    const result = await createQueensGenerator({ complete: async () => answer(JSON.stringify({ regions })) },
      { place, random: () => 0.5 }).generate(5, event => events.push(event));
    assert.equal(result.ok, true);
    assert.ok(events.some(event => event.kind === 'model' && event.path === 'algorithm'));
    assert.ok(events.some(event => event.kind === 'model' && event.reason && !event.reason.includes('형식')));
  });
  it('When the model returns compact string rows Then parses and adopts the design', async () => {
    const events: GenerationEvent[] = [];
    const result = await createQueensGenerator({ complete: async () => answer(JSON.stringify({ rows: unique.map(row => row.join('')) })) },
      { place }).generate(5, event => events.push(event));
    assert.equal(result.ok, true);
    assert.ok(events.some(event => event.kind === 'model' && event.path === 'model'));
  });
  it('When a usable proposal arrives Then applies it after code validation with a short prompt and a 20 second limit', async () => {
    let calls = 0;
    let captured: { messages: ChatMessage[]; options?: CompletionOptions } | undefined;
    const events: GenerationEvent[] = [];
    const result = await createQueensGenerator({ complete: async (messages, options) => {
      calls++; captured = { messages, options }; return answer(JSON.stringify({ regions: unique }));
    } }, { place }).generate(5, event => events.push(event));
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(captured?.options?.timeoutMs, 20_000);
    assert.deepEqual(captured?.options?.response_format, { type: 'json_object' });
    assert.ok(captured!.messages[0]!.content.length < 600);
    assert.doesNotMatch(captured!.messages[0]!.content, /unique|only solution|mentally/i);
    assert.deepEqual(JSON.parse(captured!.messages[1]!.content), { size: 5, queens: solution });
    assert.deepEqual(events.map(event => event.kind), ['placement', 'model', 'repair', 'complete']);
    assert.ok(events.some(event => event.kind === 'model' && event.path === 'model'));
    assert.ok(events.every(isGenerationEvent));
    assert.doesNotMatch(JSON.stringify(events), /"row"|"column"|"solution"|"regions"/);
    if (result.ok) {
      assert.equal(result.value.attempts, 1);
      assert.deepEqual(result.value.solution, solution);
      assert.equal(validateDesign(result.value.puzzle, solution).valid, true);
    }
  });
  for (const content of ['not JSON', '{}', '{"regions":[[1]]}', JSON.stringify({ regions: stuck })]) {
    it(`When the proposal cannot be completed (${content.slice(0, 18)}) Then falls back without a model retry`, async () => {
      let calls = 0;
      const events: GenerationEvent[] = [];
      const result = await createQueensGenerator({ complete: async () => { calls++; return answer(content); } },
        { place, random: () => 0.5 }).generate(5, event => events.push(event));
      assert.equal(calls, 1);
      assert.equal(result.ok, true);
      assert.ok(events.some(event => event.kind === 'model' && event.path !== 'model' && event.reason));
      assert.deepEqual(events.map(event => event.kind), ['placement', 'model', 'repair', 'complete']);
      assert.doesNotMatch(JSON.stringify(events), /"row"|"column"|"solution"|"regions"/);
      if (result.ok) {
        assert.deepEqual(result.value.solution, solution);
        assert.equal(validateDesign(result.value.puzzle, solution).valid, true);
      }
    });
  }
  for (const throws of [false, true]) {
    it(`When the model ${throws ? 'throws' : 'fails'} Then generates without exposing its diagnostic`, async () => {
      let calls = 0;
      const events: GenerationEvent[] = [];
      const result = await createQueensGenerator({ complete: async () => {
        calls++;
        if (throws) throw new Error('PRIVATE_DIAGNOSTIC');
        return { ok: false, reason: 'PRIVATE_DIAGNOSTIC' };
      } }, { place, random: () => 0.5 }).generate(5, event => events.push(event));
      assert.equal(result.ok, true);
      assert.equal(calls, 1);
      assert.doesNotMatch(JSON.stringify(events), /PRIVATE_DIAGNOSTIC/);
    });
  }
  it('When a model ignores cancellation Then enforces its own timeout and completes through the algorithm', { timeout: 1000 }, async t => {
    const deadline = new AbortController();
    t.mock.method(AbortSignal, 'timeout', (ms: number) => ms === 20_000 ? deadline.signal : new AbortController().signal);
    let observed: AbortSignal | undefined;
    const events: GenerationEvent[] = [];
    const pending = createQueensGenerator({ complete: async (_messages, options) => {
      observed = options?.signal; return await new Promise(() => {});
    } }, { place, random: () => 0.5 }).generate(5, event => events.push(event));
    deadline.abort(new DOMException('deadline', 'TimeoutError'));
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(observed?.aborted, true);
    assert.ok(events.some(event => event.kind === 'model' && event.path === 'algorithm' && /시간 초과/.test(event.reason!)));
  });
  for (const [name, regions] of [
    ['disconnected', [[0,2,1,1,1],[1,1,1,1,2],[1,1,2,2,2],[3,3,3,2,4],[3,3,3,4,4]]],
    ['small', [[0,0,1,1,1],[1,1,1,1,2],[1,1,2,2,2],[3,3,3,2,2],[3,3,3,4,4]]],
    ['multiple', [[0,0,1,2,2],[1,1,1,2,2],[1,1,2,2,2],[3,3,3,4,4],[4,4,4,4,4]]],
  ] as const) {
    it(`When a ${name} proposal is repairable Then code completes it in one call`, async () => {
      const events: GenerationEvent[] = [];
      const result = await createQueensGenerator({ complete: async () => answer(JSON.stringify({ regions })) }, { place })
        .generate(5, event => events.push(event));
      assert.equal(result.ok, true);
      assert.ok(events.some(event => event.kind === 'model' && event.path === 'model'));
      if (result.ok) assert.equal(validateDesign(result.value.puzzle, solution).valid, true);
    });
  }
  it('When the caller cancels Then stops rather than switching to fallback', async () => {
    const controller = new AbortController();
    const result = await createQueensGenerator({ complete: async () => {
      controller.abort(); return answer('invalid');
    } }, { place }).generate(5, undefined, controller.signal);
    assert.deepEqual(result, { ok: false, reason: '퍼즐 생성을 중단했습니다.' });
  });
  it('When fallback entry consumes the overall budget Then stops with the overall deadline reason', async () => {
    let elapsed = 0;
    const result = await createQueensGenerator({ complete: async () => answer('invalid') }, { place, now: () => elapsed })
      .generate(5, event => { if (event.kind === 'model') elapsed = 290_000; });
    assert.deepEqual(result, { ok: false, reason: timeoutReason });
  });
  it('When already cancelled or given an invalid size Then does not call the model', async () => {
    const generator = createQueensGenerator({ complete: async () => { throw new Error('Must not call'); } },
      { place: () => { throw new Error('Must not place'); } });
    for (const size of [4, 10, 5.5, NaN]) assert.equal((await generator.generate(size)).ok, false);
    const controller = new AbortController(); controller.abort();
    assert.equal((await generator.generate(5, undefined, controller.signal)).ok, false);
  });
  it('When progress crosses the HTTP boundary Then accepts summaries and rejects retired retry events', () => {
    assert.equal(isGenerationEvent({ kind: 'model', attempt: 1, path: 'algorithm', reason: '형식 오류' }), true);
    assert.equal(isGenerationEvent({ kind: 'model', attempt: 1, path: 'unknown' }), false);
    assert.equal(isGenerationEvent({ kind: 'model', attempt: 1, path: ['model'] }), false);
    for (const kind of ['attempt', 'feedback', 'candidate', 'validation']) assert.equal(isGenerationEvent({ kind, attempt: 1, retry: 0, message: 'old', regions: null }), false);
  });
});
