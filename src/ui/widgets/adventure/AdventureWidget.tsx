import { A } from '@solidjs/router';
import { createMutation } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import type { AdventureClient } from '../../../domain/adventure/types.ts';
import type { AdventureStore } from '../../state/adventure-store.ts';
import { useStore } from '../../state/solid-store.ts';
import { AdventureAsset } from '../../components/adventure/AdventureAsset.tsx';
import { ActionBar } from './ActionBar.tsx';
import { EndingPanel } from './EndingPanel.tsx';
import { NarrativeLog } from './NarrativeLog.tsx';
import { StatusBar } from './StatusBar.tsx';
import './Adventure.css';

export function AdventureWidget(props: { client: AdventureClient; store: AdventureStore }) {
  const session = useStore(props.store, (state) => state.session);
  const preview = useStore(props.store, (state) => state.preview);
  const ending = useStore(props.store, (state) => state.ending);
  const log = useStore(props.store, (state) => state.log);
  const streaming = useStore(props.store, (state) => state.streaming);
  const phase = useStore(props.store, (state) => state.phase);
  const error = useStore(props.store, (state) => state.error);
  const restored = useStore(props.store, (state) => state.restored);
  // result 또는 실패까지는 입력을 잠근다. phase 는 스트림 동안 turn 으로 유지되고,
  // mutation 이 아직 pending 이면 그 사실도 함께 본다.
  const busy = () => phase() === 'starting' || phase() === 'turn' || startGame.isPending || playTurn.isPending;
  // state 이벤트는 preview(표시 전용)만 바꾼다. 세션은 result 를 받은 commit 에서만 교체된다.
  const shown = () => preview() ?? session()?.state;
  const finished = () => Boolean(ending() ?? shown()?.ending);

  // TanStack Query 는 pending/error/취소 생명주기만 맡는다. 서술은 onEvent 로 zustand 에 흘러간다.
  // 진행 중에는 입력과 새 게임을 비활성화해, 늦은 결과가 새 상태를 덮는 상황 자체를 막는다.
  let controller: AbortController | undefined;
  const guard = (fallback: string) => (reason: unknown) => props.store.getState().fail(
    reason instanceof Error && reason.message.trim() ? reason.message : fallback,
  );

  const startGame = createMutation(() => ({
    mutationFn: async () => {
      controller = new AbortController();
      props.store.getState().beginStart();
      const result = await props.client.start(
        (event) => props.store.getState().applyEvent(event), controller.signal,
      );
      if (!result.ok) throw new Error(result.reason);
      props.store.getState().commit(result.value);
      return result.value;
    },
    retry: 0,
    networkMode: 'always',
    onError: guard('모험을 시작하지 못했습니다.'),
  }));

  const playTurn = createMutation(() => ({
    mutationFn: async (action: string) => {
      const current = props.store.getState().session;
      if (!current) throw new Error('진행 중인 모험이 없습니다.');
      controller = new AbortController();
      props.store.getState().beginTurn();
      const result = await props.client.turn(
        current, action, (event) => props.store.getState().applyEvent(event), controller.signal,
      );
      if (!result.ok) throw new Error(result.reason);
      props.store.getState().commit(result.value);
      return result.value;
    },
    retry: 0,
    networkMode: 'always',
    onError: guard('턴을 진행하지 못했습니다.'),
  }));

  const restart = () => {
    // 진행 중인 모험은 확인을 한 번 받는다(엔딩 뒤에는 바로 새 게임).
    if (session() && !finished() && !window.confirm('진행 중인 모험을 버리고 새로 시작할까요?')) return;
    props.store.getState().reset();
    startGame.mutate();
  };

  return (
    <main class="adventure-page">
      <header class="adventure-header">
        <A href="/">← 홈</A>
        <h1>잿빛 등대</h1>
        <AdventureAsset name={finished() ? 'lighthouse-lit' : 'lighthouse-dark'}
          alt="" size={32} fallback="등대" />
        <Show when={session()}>
          <button type="button" class="adventure-header__restart" onClick={restart} disabled={busy()}>
            새 게임
          </button>
        </Show>
      </header>

      <Show when={error()}><p class="adventure-error" role="alert">{error()}</p></Show>

      <Show when={!session()}>
        <section class="adventure-intro">
          <p>폭풍에 등대 불이 꺼졌습니다. 닷새째 밤, 보급선이 암초가 많은 바다를 지나갑니다.</p>
          <p>그 전에 망가진 부품 세 가지(렌즈·태엽·등유)를 찾아 고치고, 등대에 다시 불을 밝히세요.</p>
          <button type="button" onClick={() => startGame.mutate()} disabled={busy()}>
            {busy() ? '시작 중…' : '모험 시작'}
          </button>
        </section>
      </Show>

      <Show when={shown()}>
        {(state) => (
          <>
            <StatusBar state={state()} />
            <NarrativeLog log={log()} streaming={streaming()} restored={restored()} />
            <Show when={finished()} fallback={
              <ActionBar disabled={busy()} inventory={state().inventory}
                onAction={(action) => playTurn.mutate(action)}
                onStop={() => controller?.abort()} />
            }>
              <EndingPanel ending={ending() ?? state().ending ?? 'missed'} day={state().day}
                onRestart={restart} />
            </Show>
          </>
        )}
      </Show>
    </main>
  );
}
