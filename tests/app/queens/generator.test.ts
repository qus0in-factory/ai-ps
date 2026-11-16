import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueensGenerator } from '../../../src/app/queens/generator.ts';
import type { ChatMessage } from '../../../src/domain/chat.ts';
import type { CompletionOptions } from '../../../src/domain/completion.ts';
import { isGenerationEvent, type GenerationEvent } from '../../../src/domain/queens/generation.ts';

const solution = [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
const unique = [[0,0,1,1,1], [1,1,1,1,2], [1,1,2,2,2], [3,3,3,2,2], [3,3,3,4,4]];
const multiple = [[0,0,1,1,1], [0,1,1,2,2], [0,3,2,2,2], [3,3,4,4,2], [3,4,4,4,4]];
const answer = (content: string) => ({ ok: true as const, value: { role: 'assistant' as const, content } });
const place = () => solution;

describe('Given a Queens generator where code places queens and the LLM designs regions', () => {
  it('When the first design has another solution Then feeds the validation back and accepts the next unique design', async () => {
    const calls: { messages: ChatMessage[]; options?: CompletionOptions }[] = [];
    const events: GenerationEvent[] = [];
    const generator = createQueensGenerator({ complete: async (messages, options) => {
      calls.push({ messages: structuredClone(messages), options });
      return answer(JSON.stringify({ regions: calls.length === 1 ? multiple : unique }));
    } }, { place });
    const result = await generator.generate(5, event => events.push(event));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, { puzzle: { size: 5, regions: unique }, solution, attempts: 2 });
    assert.equal(calls.length, 2);
    const [first, second] = calls;
    assert.equal(first!.messages[0]!.role, 'system');
    assert.match(first!.messages[0]!.content, /region designer/i);
    assert.match(first!.messages[0]!.content, /at least 2 cells/);
    assert.match(first!.messages[0]!.content, /exactly 5 regions/);
    assert.match(first!.messages[0]!.content, /up\/down\/left\/right/);
    assert.match(first!.messages[0]!.content, /only solution/i);
    assert.match(first!.messages[0]!.content, /one queen in each row, each column and each region/i);
    assert.match(first!.messages[0]!.content, /cannot touch, even diagonally/i);
    assert.match(first!.messages[0]!.content, /"regions": \[\[\.\.\.\]\]/);
    assert.match(first!.messages[1]!.content, /\(0,0\).*\(1,2\).*\(2,4\).*\(3,1\).*\(4,3\)/s);
    assert.equal(second!.messages.at(-2)!.role, 'assistant');
    assert.match(second!.messages.at(-1)!.content, /MULTIPLE_SOLUTIONS/);
    assert.deepEqual(events.map(event => event.kind), [
      'placement', 'attempt', 'candidate', 'validation', 'feedback', 'attempt', 'candidate', 'validation', 'complete',
    ]);
  });
  it('When calling the model Then requests JSON without temperature, reasoning effort, or tools', async () => {
    let options: CompletionOptions | undefined;
    const generator = createQueensGenerator({ complete: async (_messages, value) => {
      options = value;
      return answer(JSON.stringify({ regions: unique }));
    } }, { place });
    assert.equal((await generator.generate(5)).ok, true);
    assert.deepEqual(Object.keys(options ?? {}).sort(), ['response_format', 'signal']);
    assert.deepEqual(options?.response_format, { type: 'json_object' });
  });
  it('When the reply is not a regions JSON Then gives grid feedback and retries', async () => {
    let calls = 0;
    const replies = ['not json', JSON.stringify({ regions: unique })];
    const generator = createQueensGenerator({ complete: async (messages) => {
      if (calls === 1) assert.match(messages.at(-1)!.content, /INVALID_GRID/);
      return answer(replies[calls++]!);
    } }, { place });
    assert.equal((await generator.generate(5)).ok, true);
    assert.equal(calls, 2);
  });
  it('When the reply is not JSON Then emits a serializable candidate with null regions', async () => {
    const events: GenerationEvent[] = [];
    const replies = ['not json', JSON.stringify({ regions: unique })];
    let calls = 0;
    const generator = createQueensGenerator({ complete: async () => answer(replies[calls++]!) }, { place });
    assert.equal((await generator.generate(5, event => events.push(event))).ok, true);
    const candidate = events.find(event => event.kind === 'candidate');
    assert.ok(candidate && candidate.kind === 'candidate');
    assert.equal(candidate.regions, null);
    const roundTrip: unknown = JSON.parse(JSON.stringify(candidate));
    assert.equal(isGenerationEvent(roundTrip), true);
  });
  it('When the reply has no regions key Then emits a candidate with null regions', async () => {
    const events: GenerationEvent[] = [];
    const replies = ['{"answer": 1}', JSON.stringify({ regions: unique })];
    let calls = 0;
    const generator = createQueensGenerator({ complete: async () => answer(replies[calls++]!) }, { place });
    assert.equal((await generator.generate(5, event => events.push(event))).ok, true);
    const candidate = events.find(event => event.kind === 'candidate');
    assert.ok(candidate && candidate.kind === 'candidate');
    assert.equal(candidate.regions, null);
  });
  it('When every design fails Then stops after the first attempt plus ten retries with the same placement', async () => {
    let calls = 0;
    let placements = 0;
    const generator = createQueensGenerator({ complete: async () => { calls++; return answer(JSON.stringify({ regions: multiple })); } },
      { place: () => { placements++; return solution; } });
    assert.equal((await generator.generate(5)).ok, false);
    assert.equal(calls, 11);
    assert.equal(placements, 1);
  });
  it('When the model fails Then stops without retrying', async () => {
    let calls = 0;
    const generator = createQueensGenerator({ complete: async () => { calls++; return { ok: false, reason: '모델 오류' }; } }, { place });
    assert.deepEqual(await generator.generate(5), { ok: false, reason: '모델 오류' });
    assert.equal(calls, 1);
  });
  it('When the model call is cancelled Then stops with the cancellation message', async () => {
    const controller = new AbortController();
    const generator = createQueensGenerator({ complete: async () => {
      controller.abort();
      return { ok: false, reason: 'This operation was aborted' };
    } }, { place });
    assert.deepEqual(await generator.generate(5, undefined, controller.signal),
      { ok: false, reason: '퍼즐 생성을 중단했습니다.' });
  });
  it('When the size is outside 5–9 Then rejects it before placing or calling the model', async () => {
    const generator = createQueensGenerator({ complete: async () => { throw new Error('Must not call'); } },
      { place: () => { throw new Error('Must not place'); } });
    for (const size of [4, 10, 5.5, NaN]) assert.equal((await generator.generate(size)).ok, false);
  });
  it('When cancelled before starting Then stops without placing or emitting events', async () => {
    const controller = new AbortController();
    controller.abort();
    const events: GenerationEvent[] = [];
    const generator = createQueensGenerator({ complete: async () => { throw new Error('Must not call'); } },
      { place: () => { throw new Error('Must not place'); } });
    assert.equal((await generator.generate(5, event => events.push(event), controller.signal)).ok, false);
    assert.deepEqual(events, []);
  });
});
