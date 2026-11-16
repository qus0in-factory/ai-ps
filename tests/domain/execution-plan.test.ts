import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseExecutionPlan } from '../../src/domain/execution-plan.ts';

const step = { id: 1, title: '시간 조회', name: 'get_current_time', arguments: {} };
describe('Given a JSON execution plan', () => {
  it('When the plan is valid Then parses the goal and ordered steps', () => {
    const plan = { type: 'plan', goal: '현재 시간 안내', steps: [step] };
    assert.deepEqual(parseExecutionPlan('```json\n' + JSON.stringify(plan) + '\n```'), { ok: true, value: plan });
  });
  it('When steps exceed the limit or are malformed Then rejects the plan', () => {
    for (const steps of [Array.from({ length: 5 }, (_, i) => ({ ...step, id: i + 1 })), [{ ...step, id: 3 }], [{ ...step, arguments: [] }]]) {
      assert.equal(parseExecutionPlan(JSON.stringify({ type: 'plan', goal: '계획', steps })).ok, false);
    }
  });
});
