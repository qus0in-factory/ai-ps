import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePuzzle } from '../../../src/app/queens/service.ts';

const regions = Array.from({ length: 4 }, (_, row) => Array(4).fill(row));
describe('Given the complete Queens puzzle validator', () => {
  it('When the puzzle has multiple solutions Then includes both witnesses in the error message and data', () => {
    const result = validatePuzzle({ size: 4, regions });
    assert.equal(result.valid, false);
    const issue = result.issues.find(issue => issue.code === 'MULTIPLE_SOLUTIONS')!;
    assert.equal(issue.solutions!.length, 2);
    for (const solution of issue.solutions!) assert.ok(issue.message.includes(JSON.stringify(solution)));
  });
  it('When the puzzle has one solution Then reports it as valid', () => {
    const result = validatePuzzle({ size: 4, regions: [[0,0,0,0], [0,1,1,1], [2,2,2,2], [3,3,3,3]] });
    assert.equal(result.valid, true);
    assert.equal(result.solutionStatus, 'unique');
  });
  it('When the puzzle has no solution Then reports NO_SOLUTION', () => {
    const result = validatePuzzle({ size: 4, regions: [[0,0,0,0], [0,1,1,0], [2,2,2,2], [3,3,3,3]] });
    assert.ok(result.issues.some(issue => issue.code === 'NO_SOLUTION'));
  });
  it('When structural checks fail Then reports them and skips solving', () => {
    const result = validatePuzzle({ size: 4, regions: [[0]] });
    assert.equal(result.solutionStatus, 'invalid');
    assert.equal(result.nodesVisited, 0);
  });
});
