import { A } from '@solidjs/router';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import type { QueensGenerationController } from '../../../app/queens/generation-store.ts';
import { createPlayController, type PlayState, type QueensPlayController } from '../../../app/queens/play-store.ts';
import { QueensBoard } from '../../components/queens/QueensBoard.tsx';
import { GenerationLog } from './GenerationLog.tsx';
import './QueensGeneratorWidget.css';

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
      <p>코드가 무작위로 퀸 정답 배치를 만들고, AI가 그 배치가 유일한 정답이 되도록 색상 영역을 디자인합니다. 알고리즘이 영역 연결성과 정답의 유일성을 검증합니다.</p>
      <p class="queens-note">검증에 실패하면 피드백을 전달해 최대 10회 재시도합니다. 생성에 실패할 수 있습니다.</p>
      <form onSubmit={(event) => { event.preventDefault(); void props.controller.generate(); }}>
        <label>격자 크기 <select aria-label="격자 크기" disabled={state().pending} value={state().size} onChange={(event) => props.controller.setSize(Number(event.currentTarget.value))}>
          <For each={[5,6,7,8,9]}>{(size) => <option value={size}>{size}×{size}</option>}</For>
        </select></label>
        <button type="submit" disabled={state().pending}>{state().pending ? '생성 중…' : '만들기'}</button>
      </form>
      <Show when={state().error}><p class="queens-error" role="alert">{state().error}</p></Show>
      <Show when={!state().pending && state().generated}>{(puzzle) => (
        <section class="queens-play" aria-label="퍼즐 플레이">
          <h2>플레이</h2>
          <p>{puzzle().attempts}회 시도 만에 유일한 정답이 있는 퍼즐을 만들었습니다.</p>
          <p class="queens-guide">칸을 누르면 X → 퀸 → 빈칸 순서로 바뀝니다.</p>
          <QueensBoard puzzle={puzzle().puzzle} marks={board()?.marks} conflicts={board()?.conflicts}
            disabled={Boolean(board()?.solved)}
            onCell={(row, column) => play()?.cycle(row, column)} />
          <div class="queens-playbar">
            <span class="queens-moves">이동 {board()?.moves ?? 0}회</span>
            <Show when={board()?.solved && !board()?.revealed}><strong class="queens-solved" role="status">완성!</strong></Show>
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
