import { createMemo, For, Show } from 'solid-js';
import type { CellMark } from '../../../domain/queens/play.ts';
import type { QueensPuzzle } from '../../../domain/queens/types.ts';
import { cellView } from './cell-view.ts';
import './QueensBoard.css';

const palette = ['#f3c7c7','#f6dcaf','#f7edb1','#cce3b9','#bfe3db','#c4dcf2','#d4cef0','#ebcce5','#dfd9d0'];

export function QueensBoard(props: {
  puzzle: QueensPuzzle;
  marks?: CellMark[][];
  conflicts?: boolean[][];
  onCell?: (row: number, column: number) => void;
  disabled?: boolean;
}) {
  const colors = createMemo(() => new Map([...new Set(props.puzzle.regions.flat())].map((region, index) => [region, palette[index % palette.length]!])));
  const playable = () => Boolean(props.onCell);
  const markOf = (row: number, column: number): CellMark => props.marks?.[row]?.[column] ?? 'empty';
  const edgesOf = (row: number, column: number) => {
    const regions = props.puzzle.regions;
    const region = regions[row]![column];
    const last = props.puzzle.size - 1;
    return [
      row > 0 && regions[row - 1]?.[column] !== region ? 'edge-top' : '',
      column > 0 && regions[row]?.[column - 1] !== region ? 'edge-left' : '',
      column < last && regions[row]?.[column + 1] !== region ? 'edge-right' : '',
      row < last && regions[row + 1]?.[column] !== region ? 'edge-bottom' : '',
    ].filter(Boolean).join(' ');
  };
  return (
    <table class="queens-board" classList={{ 'queens-board-play': playable() }}
      aria-label={`${props.puzzle.size}×${props.puzzle.size} Queens 퍼즐`}>
      <tbody><For each={props.puzzle.regions}>{(regionRow, row) => <tr><For each={regionRow}>{(region, column) => {
        const view = createMemo(() => cellView(markOf(row(), column()), Boolean(props.conflicts?.[row()]?.[column()]), row(), column()));
        return (
          <td class={edgesOf(row(), column())} style={{ 'background-color': colors().get(region) }}>
            <Show when={playable()} fallback={<span>{region}</span>}>
              <button type="button" class={view().className} disabled={props.disabled}
                aria-label={view().label} onClick={() => props.onCell?.(row(), column())}>
                {view().glyph}
              </button>
            </Show>
          </td>
        );
      }}</For></tr>}</For></tbody>
    </table>
  );
}
