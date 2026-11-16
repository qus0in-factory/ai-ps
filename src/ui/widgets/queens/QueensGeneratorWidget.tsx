import { A } from '@solidjs/router';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import type { QueensGenerationController } from '../../../app/queens/generation-store.ts';
import { QueensBoard } from '../../components/queens/QueensBoard.tsx';
import { GenerationLog } from './GenerationLog.tsx';
import './QueensGeneratorWidget.css';

export function QueensGeneratorWidget(props: { controller: QueensGenerationController }) {
  const [state, setState] = createSignal(props.controller.getState());
  onCleanup(props.controller.subscribe(setState));
  return (
    <main class="queens-page">
      <header><A href="/">← 홈</A><h1>Queens</h1></header>
      <p>AI가 격자를 직접 만들고, 알고리즘이 영역 연결성과 정답의 존재·유일성을 검증합니다.</p>
      <p class="queens-note">검증에 실패하면 피드백을 전달해 최대 10회 재시도합니다. 생성에 실패할 수 있습니다.</p>
      <form onSubmit={(event) => { event.preventDefault(); void props.controller.generate(); }}>
        <label>격자 크기 <select aria-label="격자 크기" disabled={state().pending} value={state().size} onChange={(event) => props.controller.setSize(Number(event.currentTarget.value))}>
          <For each={[5,6,7,8,9]}>{(size) => <option value={size}>{size}×{size}</option>}</For>
        </select></label>
        <button type="submit" disabled={state().pending}>{state().pending ? '생성 중…' : '만들기'}</button>
      </form>
      <Show when={state().error}><p class="queens-error" role="alert">{state().error}</p></Show>
      <Show when={state().generated}>{(generated) => (
        <section aria-label="생성 결과"><h2>생성 결과</h2><p>{generated().attempts}회 생성 시도 · 정답 1개 검증 완료</p><QueensBoard puzzle={generated().puzzle} /></section>
      )}</Show>
      <GenerationLog events={state().events} />
    </main>
  );
}
