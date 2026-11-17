import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpQueensGenerator } from '../../src/infra/http-queens-generator.ts';
import { solveQueens } from '../../src/domain/queens/solver.ts';

const puzzle = { size: 5, regions: [[0,0,1,1,1], [0,0,1,1,1], [2,3,3,1,1], [2,3,3,1,1], [3,3,3,1,4]] };
describe('Given the Queens streaming client', () => {
  it('When progress and a final result arrive Then reports events and finishes without waiting for EOF', async () => {
    let cancelled = false;
    const generated = { puzzle, solution: solveQueens(puzzle).solutions[0], attempts: 1 };
    const received: unknown[] = [];
    const generator = createHttpQueensGenerator(async (url, options) => {
      assert.equal(url, '/api/queens/generate');
      assert.deepEqual(JSON.parse(options!.body as string), { size: 5 });
      const bytes = new TextEncoder().encode(JSON.stringify({ type: 'event', event: { kind: 'placement', attempt: 1 } }) + '\n' + JSON.stringify({ type: 'result', value: generated }) + '\n');
      return new Response(new ReadableStream({
        start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); },
        cancel() { cancelled = true; },
      }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    });
    assert.deepEqual(await generator.generate(5, event => received.push(event)), { ok: true, value: generated });
    assert.equal(received.length, 1);
    assert.equal(cancelled, true);
  });
  it('When the server reports a validation failure Then returns the problem detail', async () => {
    const generator = createHttpQueensGenerator(async () => new Response(JSON.stringify({ type: 'problem', problem: { detail: '검증에 실패했습니다.' } }) + '\n'));
    assert.deepEqual(await generator.generate(5), { ok: false, reason: '검증에 실패했습니다.' });
  });
});
