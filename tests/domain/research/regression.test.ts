import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareEvalRuns, validateEvalAlignment, type EvalCase } from '../../../src/domain/research/regression.ts';
import type { RubricScores } from '../../../src/domain/research/rubric.ts';

const scores = (grounded: number, structured: number, clear: number): RubricScores =>
  ({ grounded, structured, clear, reasons: '' });

const entry = (topic: string, passing: boolean, value: RubricScores): EvalCase => ({
  topic, citations: { passed: passing }, effort: { passed: passing }, scores: value,
});

describe('Given two research evaluation runs', () => {
  it('When a topic passes code checks before and fails after Then it is a regression', () => {
    const result = compareEvalRuns(
      [entry('주제', true, scores(5, 5, 5))],
      [entry('주제', false, scores(5, 5, 5))],
    );
    assert.deepEqual(result, [{ topic: '주제', verdict: 'regression' }]);
  });

  it('When code checks still pass but the rubric average drops Then half a point is a regression and 0.49 is not', () => {
    const baseline = [entry('주제', true, scores(4, 4, 4))];
    assert.deepEqual(compareEvalRuns(baseline, [entry('주제', true, scores(3.5, 3.5, 3.5))]), [
      { topic: '주제', verdict: 'regression' },
    ]);
    assert.deepEqual(compareEvalRuns(baseline, [entry('주제', true, scores(3.51, 3.51, 3.51))]), [
      { topic: '주제', verdict: 'same' },
    ]);
  });

  it('When a topic failed before and passes after Then it is an improvement', () => {
    const result = compareEvalRuns(
      [entry('주제', false, scores(2, 2, 2))],
      [entry('주제', true, scores(2, 2, 2))],
    );
    assert.deepEqual(result, [{ topic: '주제', verdict: 'improvement' }]);
  });

  it('When run lengths differ Then only the shared prefix is compared', () => {
    const result = compareEvalRuns(
      [entry('가', true, scores(5, 5, 5)), entry('나', true, scores(5, 5, 5))],
      [entry('가', true, scores(5, 5, 5))],
    );
    assert.deepEqual(result, [{ topic: '가', verdict: 'same' }]);
    assert.deepEqual(compareEvalRuns([], [entry('가', true, scores(5, 5, 5))]), []);
  });
});

describe('Given a baseline gate alignment check', () => {
  it('When topics and order match Then no problems are reported', () => {
    const baseline = [entry('가', true, scores(5, 5, 5)), entry('나', true, scores(5, 5, 5))];
    assert.deepEqual(validateEvalAlignment(baseline, baseline.map(item => ({ ...item }))), []);
  });

  it('When a baseline topic is missing or an extra topic appears Then it is reported', () => {
    const baseline = [entry('가', true, scores(5, 5, 5)), entry('나', true, scores(5, 5, 5))];
    const problems = validateEvalAlignment(baseline, [entry('가', true, scores(5, 5, 5))]);
    assert.ok(problems.some(problem => problem.includes('누락') && problem.includes('나')));
    assert.ok(problems.some(problem => problem.includes('수 불일치')));
    const extra = validateEvalAlignment(baseline, [...baseline, entry('다', true, scores(5, 5, 5))]);
    assert.ok(extra.some(problem => problem.includes('추가') && problem.includes('다')));
  });

  it('When topics are reordered Then the mismatch is reported per position', () => {
    const baseline = [entry('가', true, scores(5, 5, 5)), entry('나', true, scores(5, 5, 5))];
    const problems = validateEvalAlignment(baseline, [baseline[1]!, baseline[0]!]);
    assert.ok(problems.some(problem => problem.includes('순서') && problem.includes('가') && problem.includes('나')));
  });
});
