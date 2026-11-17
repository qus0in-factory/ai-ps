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
  for (const size of [5, 9]) {
    it(`When both real-smoke placements encounter model timeouts on ${size}x${size} Then finishes algorithm fallback inside the reserved budget`, async () => {
      let modelElapsed = 0, calls = 0, seed = 20261117 + size;
      let solution: QueensSolution = [];
      const started = performance.now();
      const generator = createQueensGenerator({ complete: async (_messages, options) => {
        calls++;
        modelElapsed += options!.timeoutMs!;
        return { ok: false, reason: '모델 응답 시간이 초과되었습니다.' };
      } }, {
        random: () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32),
        now: () => modelElapsed + performance.now() - started,
      });
      const result = await generator.generate(size, event => {
        if (event.kind === 'placement') solution = event.solution;
      });
      assert.equal(calls, 2);
      assert.equal(result.ok, true);
      assert.ok(modelElapsed + performance.now() - started < 290_000);
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
    const spent = Number(finalRepair.message.match(/solver 예산 (\d+)\/1000회/)?.[1]);
    assert.ok(spent > 0 && spent <= 1000);
    assert.ok(events.some(event => event.kind === 'stopped' && /solver 1000회/.test(event.reason)));
    assert.equal(events.at(-1)?.kind, 'stopped');
  });
  it('When cancellation is queued during CPU fallback Then yields after at most two restarts', async () => {
    let drawsPerRestart = 0, draws = 0;
    growRegionsFromSolution(5, place(), () => { drawsPerRestart++; return 0; });
    const controller = new AbortController();
    const generator = createQueensGenerator(model, { place, now: () => 0, random: () => { draws++; return 0; } });
    const result = await generator.generate(5, event => {
      if (event.kind === 'repair' && /같은 정답 배치/.test(event.message)) setTimeout(() => controller.abort(), 0);
    }, controller.signal);
    assert.deepEqual(result, { ok: false, reason: '퍼즐 생성을 중단했습니다.' });
    assert.ok(draws > 0 && draws <= drawsPerRestart * 2);
  });
});
