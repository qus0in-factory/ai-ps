import { A } from '@solidjs/router';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { QueensGenerationController } from '../../../app/queens/generation-store.ts';
import { createPlayController, type PlayState, type QueensPlayController } from '../../../app/queens/play-store.ts';
import { QueensBoard } from '../../components/queens/QueensBoard.tsx';
import { Select } from '../../components/select/Select.tsx';
import { GenerationLog } from './GenerationLog.tsx';
import './QueensGeneratorWidget.css';

const sizes = [5, 6, 7, 8, 9].map((size) => ({ value: String(size), label: `${size}×${size}` }));

export function QueensGeneratorWidget(props: { controller: QueensGenerationController }) {
  const [state, setState] = createSignal(props.controller.getState());
  onCleanup(props.controller.subscribe(setState));
  const [play, setPlay] = createSignal<QueensPlayController>();
  const [board, setBoard] = createSignal<PlayState>();
  let generated: unknown;
  let unsubscribe: (() => void) | undefined;
  createEffect(() => {
    const next = state().generated;
    if (next === generated) return;
    generated = next;
    unsubscribe?.();
    unsubscribe = undefined;
    if (!next) { setPlay(undefined); setBoard(undefined); return; }
    const controller = createPlayController(next.puzzle, next.solution);
    setPlay(controller);
    setBoard(controller.getState());
    unsubscribe = controller.subscribe(setBoard);
  });
  onCleanup(() => unsubscribe?.());
  return (
    <main class="queens-page">
      <header><A href="/">← 홈</A><h1>Queens</h1></header>
      <p>모델이 영역 모양을 제안하고 코드가 유일한 정답으로 다듬습니다.</p>
      <p class="queens-note">모델 응답이 없거나 어긋나도 코드가 퍼즐을 완성합니다.</p>
      <form onSubmit={(event) => { event.preventDefault(); void props.controller.generate(); }}>
        <label>격자 크기 <Select label="격자 크기" value={state().size} options={sizes} disabled={state().pending}
          onChange={(value) => props.controller.setSize(Number(value))} /></label>
        <button type="submit" disabled={state().pending}>{state().pending ? '생성 중…' : '만들기'}</button>
      </form>
      <Show when={state().error}><p class="queens-error" role="alert">{state().error}</p></Show>
      <Show when={!state().pending && state().generated}>{(puzzle) => (
        <section class="queens-play" aria-label="퍼즐 플레이">
          <h2>플레이</h2>
          <p>유일한 정답이 있는 퍼즐을 만들었습니다.</p>
          <p class="queens-guide">칸을 누르면 X → 퀸 → 빈칸 순서로 바뀝니다.</p>
          <QueensBoard puzzle={puzzle().puzzle} marks={board()?.marks} conflicts={board()?.conflicts}
            disabled={Boolean(board()?.solved)}
            onCell={(row, column) => play()?.cycle(row, column)} />
          <div class="queens-playbar">
            <span class="queens-moves">이동 {board()?.moves ?? 0}회</span>
            <Show when={board()?.solved && !board()?.revealed}><strong class="queens-solved" role="status">정답입니다</strong></Show>
            <Show when={board()?.revealed}><span class="queens-revealed">정답 공개</span></Show>
            <button type="button" onClick={() => play()?.reset()}>다시 하기</button>
            <button type="button" onClick={() => play()?.reveal()} disabled={Boolean(board()?.revealed)}>정답 보기</button>
          </div>
        </section>
      )}</Show>
      <GenerationLog events={state().events} />
    </main>
  );
}
