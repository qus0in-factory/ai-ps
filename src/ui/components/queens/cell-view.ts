import type { CellMark } from '../../../domain/queens/play.ts';

const glyphs: Record<CellMark, string> = { empty: '', cross: '×', queen: '♛' };
const labels: Record<CellMark, string> = { empty: '빈칸', cross: 'X', queen: '퀸' };

export interface CellView {
  glyph: string;
  className: string;
  label: string;
}

export function cellView(mark: CellMark, conflict: boolean, row: number, column: number): CellView {
  const conflicted = conflict && mark === 'queen';
  return {
    glyph: glyphs[mark],
    className: conflicted ? 'queens-cell conflict' : 'queens-cell',
    label: `${row + 1}행 ${column + 1}열, ${labels[mark]}${conflicted ? ', 충돌' : ''}`,
  };
}
