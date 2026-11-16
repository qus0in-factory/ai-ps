import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDesign } from '../../../src/domain/queens/design.ts';

const solution = [0, 2, 4, 1, 3].map((column, row) => ({ row, column }));
const unique = [[0,0,1,1,1], [1,1,1,1,2], [1,1,2,2,2], [3,3,3,2,2], [3,3,3,4,4]];

describe('Given a region design for a fixed queen placement', () => {
  it('When the placement is the only solution and every region has two cells Then accepts it', () => {
    const report = validateDesign({ size: 5, regions: unique }, solution);
    assert.equal(report.valid, true);
    assert.equal(report.solutionStatus, 'unique');
    assert.deepEqual(report.solutions[0], solution);
  });
  it('When a region has a single cell Then reports REGION_TOO_SMALL before solving', () => {
    const regions = unique.map(row => [...row]);
    regions[0]![1] = 1;
    const report = validateDesign({ size: 5, regions }, solution);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(issue => issue.code === 'REGION_TOO_SMALL' && issue.region === 0));
  });
  it('When a region holds two of the given queens Then reports the placement conflict', () => {
    const regions = [[0,0,1,1,1], [0,0,0,1,2], [0,0,2,2,2], [3,3,3,2,2], [3,3,3,4,4]];
    const report = validateDesign({ size: 5, regions }, solution);
    assert.equal(report.valid, false);
    assert.ok(report.issues.some(issue => issue.code === 'REGION_CONFLICT'));
  });
  it('When another placement also solves the grid Then reports MULTIPLE_SOLUTIONS', () => {
    const regions = [[0,0,1,1,1], [0,1,1,2,2], [0,3,2,2,2], [3,3,4,4,2], [3,4,4,4,4]];
    const report = validateDesign({ size: 5, regions }, solution);
    assert.equal(report.valid, false);
    assert.equal(report.solutionStatus, 'multiple');
    assert.ok(report.issues.some(issue => issue.code === 'MULTIPLE_SOLUTIONS'));
  });
  it('When the grid shape is broken Then returns the grid issues', () => {
    const report = validateDesign({ size: 5, regions: [[0]] }, solution);
    assert.equal(report.solutionStatus, 'invalid');
    assert.equal(report.issues[0]!.code, 'INVALID_GRID');
  });
});
