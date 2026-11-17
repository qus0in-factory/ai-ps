import { A } from '@solidjs/router';
import { createMutation } from '@tanstack/solid-query';
import { Show, onCleanup } from 'solid-js';
import type { TalkClient } from '../../../domain/talk/types.ts';
import { createTalkController, canSend, isBusy, atLimit, TALK_LIMITS } from '../../../app/talk/session-store.ts';
import type { TalkStore } from '../../state/talk-store.ts';
import { useStore } from '../../state/solid-store.ts';
import { phaseLabel, draftHint } from '../../components/talk/phase-label.ts';
import { TranscriptLog } from './TranscriptLog.tsx';
import { ReportPanel } from './ReportPanel.tsx';
import './Talk.css';

export function TalkWidget(props: { client: TalkClient; store: TalkStore }) {
  const view = useStore(props.store, state => state);
  const controller = createTalkController(props.client, props.store);
  const settle = async (pending: ReturnType<typeof controller.start>) => {
    const result = await pending;
    if (!result.ok) throw new Error(result.reason);
  };
  const start = createMutation(() => ({ mutationFn: () => settle(controller.start()), retry: 0, networkMode: 'always' as const }));
  const send = createMutation(() => ({ mutationFn: (text: string) => settle(controller.send(text)), retry: 0, networkMode: 'always' as const }));
  const finish = createMutation(() => ({ mutationFn: () => settle(controller.finish()), retry: 0, networkMode: 'always' as const }));
  const busy = () => isBusy(view()) || start.isPending || send.isPending || finish.isPending;
  onCleanup(() => controller.cancel());

  return <main class="talk-page">
    <header class="talk-header">
      <A href="/" class="talk-home">← 홈</A>
      <div><span class="talk-eyebrow">TALK</span><h1>일본어 회화</h1></div>
      <Show when={view().session}><button type="button" class="talk-button talk-secondary" disabled={busy()} onClick={() => controller.reset()}>새 연습</button></Show>
    </header>
    <p class="talk-lead">한 문장부터, 편하게 이야기해요.</p>
    <Show when={view().error}><p class="talk-error" role="alert">{view().error}</p></Show>
    <Show when={!view().session}>
      <section class="talk-intro">
        <span class="talk-eyebrow">매일 조금씩, 일본어로</span>
        <h2>오늘 있었던 일부터 시작할까요?</h2>
        <p>쉬운 일본어로 짧게 답하면 튜터가 대화를 이어가요. 필요한 교정과 자연스러운 표현은 대화 옆에 보여드릴게요.</p>
        <p class="talk-example" lang="ja">「今日は散歩しました。」</p>
        <button type="button" class="talk-button talk-primary" disabled={busy()} onClick={() => start.mutate()}>연습 시작</button>
        <p class="talk-note">대화는 이 브라우저에 저장돼요. 새로고침해도 이어갈 수 있어요.</p>
      </section>
    </Show>
    <Show when={view().session}>{session => <>
      <div class="talk-session-heading"><h2>우리의 대화</h2><span>{session().turns.length} / {TALK_LIMITS.turns}턴</span></div>
      <TranscriptLog turns={session().turns} />
      <Show when={view().phase !== 'ended'}>
        <form class="talk-compose" onSubmit={event => {
          event.preventDefault(); if (!busy() && canSend(view())) send.mutate(view().learnerText);
        }}>
          <label for="talk-input">내 이야기</label>
          <textarea id="talk-input" name="text" lang="ja" rows={3} maxLength={TALK_LIMITS.learner}
            aria-describedby="talk-input-hint" placeholder="今日は何をしましたか？" value={view().learnerText}
            disabled={busy() || atLimit(view())}
            onInput={event => props.store.setState({ learnerText: event.currentTarget.value })} />
          <div class="talk-compose-meta"><small id="talk-input-hint">{draftHint(view())}</small><span>{view().learnerText.length}/{TALK_LIMITS.learner}</span></div>
          <div class="talk-actions">
            <button type="submit" class="talk-button talk-primary" disabled={busy() || !canSend(view())}>보내기</button>
            <button type="button" class="talk-button talk-secondary" disabled={busy()} onClick={() => finish.mutate()}>연습 마치기 · 보고서</button>
          </div>
        </form>
      </Show>
    </>}</Show>
    <div class="talk-status-row">
      <p role="status" aria-live="polite">{phaseLabel(view().phase)}</p>
      <Show when={busy()}><button type="button" class="talk-button talk-secondary" onClick={() => controller.cancel()}>중단</button></Show>
    </div>
    <Show when={view().report}>{report => <ReportPanel report={report()} />}</Show>
  </main>;
}
