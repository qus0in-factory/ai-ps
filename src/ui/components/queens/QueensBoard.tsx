import { createMemo, For } from 'solid-js';
import type { QueensPuzzle } from '../../../domain/queens/types.ts';
import './QueensBoard.css';

const palette = ['#f3c7c7','#f6dcaf','#f7edb1','#cce3b9','#bfe3db','#c4dcf2','#d4cef0','#ebcce5','#dfd9d0'];
export function QueensBoard(props: { puzzle: QueensPuzzle }) {
  const colors = createMemo(() => new Map([...new Set(props.puzzle.regions.flat())].map((region, index) => [region, palette[index % palette.length]!])));
  return (
    <table class="queens-board" aria-label={`${props.puzzle.size}×${props.puzzle.size} Queens 퍼즐`}>
      <tbody><For each={props.puzzle.regions}>{(row) => <tr><For each={row}>{(region) => (
        <td style={{ 'background-color': colors().get(region) }}><span>{region}</span></td>
      )}</For></tr>}</For></tbody>
    </table>
  );
}
