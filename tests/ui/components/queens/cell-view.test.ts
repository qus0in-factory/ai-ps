import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cellView } from '../../../../src/ui/components/queens/cell-view.ts';

describe('Given a Queens cell whose display is derived from its mark and conflict flag', () => {
  it('When the cell is empty Then shows no glyph and a blank label', () => {
    assert.deepEqual(cellView('empty', false, 0, 0), {
      glyph: '', className: 'queens-cell', label: '1행 1열, 빈칸',
    });
  });
  it('When the cell is crossed out Then shows × and keeps the one-based position', () => {
    assert.deepEqual(cellView('cross', false, 3, 7), {
      glyph: '×', className: 'queens-cell', label: '4행 8열, X',
    });
  });
  it('When a queen has no conflict Then shows ♛ without the conflict class', () => {
    assert.deepEqual(cellView('queen', false, 0, 2), {
      glyph: '♛', className: 'queens-cell', label: '1행 3열, 퀸',
    });
  });
  it('When a queen conflicts Then adds the conflict class and announces the conflict', () => {
    assert.deepEqual(cellView('queen', true, 4, 0), {
      glyph: '♛', className: 'queens-cell conflict', label: '5행 1열, 퀸, 충돌',
    });
  });
  it('When a non-queen cell carries a conflict flag Then ignores it', () => {
    for (const mark of ['empty', 'cross'] as const) {
      const view = cellView(mark, true, 1, 1);
      assert.equal(view.className, 'queens-cell');
      assert.ok(!view.label.includes('충돌'));
    }
  });
});
