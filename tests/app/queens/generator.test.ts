import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueensGenerator } from '../../../src/app/queens/generator.ts';
import { createQueensService } from '../../../src/app/queens/service.ts';
import { createQueensTools } from '../../../src/infra/queens-tools.ts';

const valid = { size: 5, regions: [[0,0,1,1,1], [0,0,1,1,1], [2,3,3,1,1], [2,3,3,1,1], [3,3,3,1,4]] };
const invalid = { size: 5, regions: Array.from({ length: 5 }, (_, row) => Array(5).fill(row)) };
const response = (puzzle: unknown, id: string) => ({ ok: true as const, value: { role: 'assistant' as const, content: null,
  tool_calls: [{ id, type: 'function' as const, function: { name: 'verify_puzzle', arguments: JSON.stringify(puzzle) } }],
} });
const verifier = () => createQueensTools(createQueensService())[0]!;

describe('Given a direct LLM Queens generator', () => {
  it('When validation fails Then sends detailed feedback and accepts the next valid candidate', async () => {
    let calls = 0;
    const events: unknown[] = [];
    const generator = createQueensGenerator({ complete: async (messages, tools, options) => {
      assert.equal(options?.temperature, 0.8);
      assert.deepEqual(options?.tool_choice, { type: 'function', function: { name: 'verify_puzzle' } });
      assert.equal(tools[0]?.name, 'verify_puzzle');
      if (calls++ === 0) return response(invalid, 'candidate-1');
      const feedback = messages.findLast(message => message.role === 'tool');
      assert.ok(feedback && feedback.role === 'tool');
      if (feedback?.role === 'tool') {
        const report = JSON.parse(feedback.content);
        assert.equal(report.valid, false);
        assert.equal(report.issues[0].solutions.length, 2);
        assert.match(report.issues[0].message, /두 정답/);
      }
      return response(valid, 'candidate-2');
    } }, verifier());
    const result = await generator.generate(5, (event) => events.push(event));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.puzzle, valid);
      assert.equal(result.value.attempts, 2);
    }
    assert.equal(calls, 2);
    assert.equal(events.filter((event: any) => event.kind === 'feedback').length, 1);
  });
  it('When every candidate fails Then stops after the first attempt plus ten retries', async () => {
    let calls = 0;
    const generator = createQueensGenerator({ complete: async () => response(invalid, `candidate-${++calls}`) }, verifier());
    const result = await generator.generate(5);
    assert.equal(result.ok, false);
    assert.equal(calls, 11);
  });
  it('When the model returns a unique board of the wrong size Then rejects it', async () => {
    let calls = 0;
    const wrong = { size: 4, regions: [[0,0,0,0], [0,1,1,1], [2,2,2,2], [3,3,3,3]] };
    const generator = createQueensGenerator({ complete: async () => response(wrong, `wrong-${++calls}`) }, verifier());
    assert.equal((await generator.generate(5)).ok, false);
    assert.equal(calls, 11);
  });
  it('When the size is outside 5–9 Then rejects it before model calls', async () => {
    const generator = createQueensGenerator({ complete: async () => { throw new Error('Must not call'); } }, verifier());
    for (const size of [4,10,5.5,NaN]) assert.equal((await generator.generate(size)).ok, false);
  });
  it('When cancelled Then stops before another attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const generator = createQueensGenerator({ complete: async () => { throw new Error('Must not call'); } }, verifier());
    assert.equal((await generator.generate(5, undefined, controller.signal)).ok, false);
  });
});
