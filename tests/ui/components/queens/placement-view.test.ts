import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placementView } from '../../../../src/ui/components/queens/placement-view.ts';

describe('Given a generated answer placement shown in the generation log', () => {
  it('When rendered Then the summary hides the coordinates so the answer is not spoiled', () => {
    const view = placementView([{ row: 0, column: 1 }, { row: 1, column: 3 }]);
    assert.equal(view.summary, '정답 배치 생성 (펼쳐서 보기)');
    assert.doesNotMatch(view.summary, /\d/);
  });
  it('When expanded Then the detail lists every queen position', () => {
    assert.equal(placementView([{ row: 0, column: 1 }, { row: 1, column: 3 }]).detail, '(0, 1), (1, 3)');
  });
});
