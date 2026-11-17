import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueensGenerator } from '../../../src/app/queens/generator.ts';
import type { GenerationEvent } from '../../../src/domain/queens/generation.ts';
import { validateDesign } from '../../../src/domain/queens/design.ts';
import type { QueensSolution } from '../../../src/domain/queens/types.ts';
import { growRegionsFromSolution } from '../../../src/domain/queens/repair.ts';

const place = () => [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
const model = { complete: async () => ({ ok: true as const, value: { role: 'assistant' as const, content: 'invalid' } }) };

describe('Given bounded algorithm fallback restarts', () => {
  it('When retained model seeds exhaust their allowance Then still runs the pure algorithm with its own budget', async () => {
    const regions = [[0,0,1,1,1],[0,1,1,2,2],[0,3,2,2,2],[3,3,4,4,2],[3,4,4,4,4]];
    const events: GenerationEvent[] = [];
    const result = await createQueensGenerator({ complete: async () => ({ ok: true, value: {
      role: 'assistant', content: JSON.stringify({ regions }),
    } }) }, { place, random: () => 0, now: () => 0 }).generate(5, event => events.push(event));
    assert.equal(result.ok, false);
    assert.ok(events.some(event => event.kind === 'model' && event.path === 'algorithm' && event.reason === '모델 시드 탐색 한도 소진'));
    assert.ok(events.some(event => event.kind === 'repair' && /solver 예산 4000\/4000회/.test(event.message)));
  });
  it('When the model cannot help on the measured 9x9 placement Then gives algorithm restarts enough bounded work', async () => {
    let seed = 424242;
    const result = await createQueensGenerator(model, {
      random: () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32),
      now: () => 0,
    }).generate(9);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(validateDesign(result.value.puzzle, result.value.solution).valid, true);
  });
  for (const size of [5, 9]) {
    it(`When the optional model times out on ${size}x${size} Then finishes algorithm fallback well inside thirty seconds`, async () => {
      let modelElapsed = 0, calls = 0, seed = 20261117 + size;
      let solution: QueensSolution = [];
      const started = performance.now();
      const generator = createQueensGenerator({ complete: async (_messages, options) => {
        calls++;
        solution = JSON.parse(_messages[1]!.content).queens;
        modelElapsed += 20_000;
        assert.ok(options?.signal instanceof AbortSignal);
        return { ok: false, reason: '모델 응답 시간이 초과되었습니다.' };
      } }, {
        random: () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32),
        now: () => modelElapsed + performance.now() - started,
      });
      const result = await generator.generate(size);
      assert.equal(calls, 1);
      assert.equal(result.ok, true);
      assert.ok(modelElapsed + performance.now() - started < 30_000);
      if (result.ok) {
        assert.deepEqual(result.value.solution, solution);
        assert.equal(validateDesign(result.value.puzzle, solution).valid, true);
      }
    });
  }

  it('When the Workers CPU clock is frozen Then still stops at the cumulative solver budget', async () => {
    const events: GenerationEvent[] = [];
    const generator = createQueensGenerator(model, { place, random: () => 0, now: () => 0 });
    const result = await generator.generate(5, event => events.push(event));
    assert.equal(result.ok, false);
    const finalRepair = events.filter(event => event.kind === 'repair').at(-1);
    assert.ok(finalRepair && finalRepair.kind === 'repair');
    const spent = Number(finalRepair.message.match(/solver 예산 (\d+)\/4000회/)?.[1]);
    assert.ok(spent > 0 && spent <= 4000);
    assert.ok(events.some(event => event.kind === 'stopped' && /solver 4000회/.test(event.reason)));
    assert.equal(events.at(-1)?.kind, 'stopped');
  });
  it('When cancellation is queued during CPU fallback Then yields after at most two restarts', async () => {
    let drawsPerRestart = 0, draws = 0;
    growRegionsFromSolution(5, place(), () => { drawsPerRestart++; return 0; });
    const controller = new AbortController();
    const generator = createQueensGenerator({ complete: async () => {
      setTimeout(() => controller.abort(), 0); return await model.complete();
    } }, { place, now: () => 0, random: () => { draws++; return 0; } });
    const result = await generator.generate(5, undefined, controller.signal);
    assert.deepEqual(result, { ok: false, reason: '퍼즐 생성을 중단했습니다.' });
    assert.ok(draws > 0 && draws <= drawsPerRestart * 2);
  });
});
