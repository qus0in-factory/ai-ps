import { Mic, Square } from 'lucide-solid';
import type { AudioPlayer } from '../../../domain/talk/listening.ts';
import { createListeningController, initialListeningView } from '../../../app/talk/listening.ts';
import type { Recorder } from '../../../domain/talk/recording.ts';
import { createRecordingController } from '../../../app/talk/recording.ts';
import { A } from '@solidjs/router';
import { createMutation } from '@tanstack/solid-query';
import { For, Show, onCleanup, createSignal } from 'solid-js';
import type { TalkClient } from '../../../domain/talk/types.ts';
import { createTalkController, canSend, isBusy, atLimit, activeTutorMood, TALK_LIMITS } from '../../../app/talk/session-store.ts';
import type { TalkStore } from '../../state/talk-store.ts';
import { useStore } from '../../state/solid-store.ts';
import { phaseLabel, draftHint } from '../../components/talk/phase-label.ts';
import { TranscriptLog } from './TranscriptLog.tsx';
import { TutorPortrait } from './TutorPortrait.tsx';
import { ReportPanel } from './ReportPanel.tsx';
import './Talk.css';

export function TalkWidget(props: { audioPlayer: AudioPlayer; recorder: Recorder; client: TalkClient; store: TalkStore }) {
  const [listeningView, setListeningView] = createSignal(initialListeningView());
  const listening = createListeningController(props.client, props.audioPlayer, setListeningView);
  const view = useStore(props.store, state => state);
  const controller = createTalkController(props.client, props.store);
  const recording = createRecordingController(props.recorder, props.client, props.store);
  const settle = async (pending: ReturnType<typeof controller.start>) => {
    const result = await pending;
    if (!result.ok) throw new Error(result.reason);
  };
  const start = createMutation(() => ({ mutationFn: () => settle(controller.start()), retry: 0, networkMode: 'always' as const }));
  const send = createMutation(() => ({ mutationFn: (text: string) => settle(controller.send(text)), retry: 0, networkMode: 'always' as const }));
  const finish = createMutation(() => ({ mutationFn: () => settle(controller.finish()), retry: 0, networkMode: 'always' as const }));
  const capture = createMutation(() => ({ mutationFn: () => { listening.stop(); return settle(recording.record()); }, retry: 0, networkMode: 'always' as const }));
  const busy = () => capture.isPending || isBusy(view()) || start.isPending || send.isPending || finish.isPending;
  onCleanup(() => { controller.cancel(); recording.cancel(); listening.dispose(); });

  return <main class="talk-page">
    <header class="talk-header">
      <A href="/" class="talk-home">← 홈</A>
      <div><span class="talk-eyebrow">TALK</span><h1>일본어 회화</h1></div>
      <Show when={view().session}><button type="button" class="talk-button talk-secondary" disabled={busy()} onClick={() => { listening.clear(); controller.reset(); }}>새 연습</button></Show>
    </header>
    <p class="talk-lead">한 문장부터, 편하게 이야기해요.</p>
    <Show when={view().error}><p class="talk-error" role="alert">{view().error}</p></Show>
    <Show when={!view().session}>
      <section class="talk-intro">
        <span class="talk-eyebrow">매일 조금씩, 일본어로</span>
        <h2>오늘 있었던 일부터 시작할까요?</h2>
        <p>쉬운 일본어로 짧게 답하면 튜터가 대화를 이어가요. 필요한 교정과 자연스러운 표현은 대화 옆에 보여드릴게요.</p>
        <p class="talk-example" lang="ja">「今日は散歩しました。」</p>
        <fieldset class="talk-tutor-choice" disabled={busy()}>
          <legend>함께 연습할 튜터를 골라주세요</legend>
          <div class="talk-tutor-options">
            <For each={['f', 'm'] as const}>{tutor => <button type="button" class="talk-tutor-option"
              aria-pressed={view().selectedTutor === tutor} onClick={() => controller.selectTutor(tutor)}>
              <TutorPortrait tutor={tutor} mood="neutral" decorative />
              <strong>{tutor === 'f' ? '여성 튜터' : '남성 튜터'}</strong>
              <span>{view().selectedTutor === tutor ? '선택됨' : '선택하기'}</span>
            </button>}</For>
          </div>
        </fieldset>
        <button type="button" class="talk-button talk-primary" disabled={busy()} onClick={() => start.mutate()}>연습 시작</button>
        <p class="talk-note">대화는 이 브라우저에 저장돼요. 새로고침해도 이어갈 수 있어요.</p>
      </section>
    </Show>
    <Show when={view().session || busy()}>
      <section class="talk-current-tutor" aria-label="현재 튜터">
        <TutorPortrait tutor={view().session?.tutor ?? view().selectedTutor} mood={activeTutorMood(view())} />
        <div><strong>{(view().session?.tutor ?? view().selectedTutor) === 'f' ? '여성 튜터' : '남성 튜터'}</strong>
          <p>{view().phase === 'recording' ? '편하게 일본어로 이야기해 주세요.' : busy() ? '잠시만요, 생각하고 있어요.' : view().phase === 'ended' ? '연습을 마쳤어요. 다음 연습에서 만나요.' : '당신의 이야기를 듣고 있어요.'}</p></div>
      </section>
    </Show>
    <Show when={view().session}>{session => <>
      <div class="talk-session-heading"><h2>우리의 대화</h2><span>{session().turns.length} / {TALK_LIMITS.turns}턴</span></div>
      <TranscriptLog turns={session().turns} listening={listeningView()} onListen={text => { void listening.toggle(text); }} recording={view().phase === 'recording' || view().phase === 'requesting-microphone'} />
      <Show when={view().phase !== 'ended'}>
        <form class="talk-compose" onSubmit={event => {
          event.preventDefault(); if (!busy() && canSend(view())) send.mutate(view().learnerText);
        }}>
          <label for="talk-input">내 이야기</label>
          <textarea id="talk-input" name="text" lang="ja" rows={3} maxLength={TALK_LIMITS.learner}
            aria-describedby="talk-input-hint" placeholder="今日は何をしましたか？" value={view().learnerText}
            disabled={view().phase === 'thinking' || view().phase === 'reporting' || atLimit(view())}
            onInput={event => props.store.setState({ learnerText: event.currentTarget.value })} />
          <div class="talk-compose-meta"><small id="talk-input-hint">{draftHint(view())}</small><span>{view().learnerText.length}/{TALK_LIMITS.learner}</span></div>
          <div class="talk-record-controls">
            <button type="button" class="talk-button talk-secondary talk-record-button" aria-pressed={view().phase === 'recording'}
              disabled={!props.recorder.supported || atLimit(view()) || (busy() && view().phase !== 'recording')}
              onClick={() => view().phase === 'recording' ? recording.stop() : capture.mutate()}>
              <Show when={view().phase === 'recording'} fallback={<Mic size={18} aria-hidden="true" />}><Square size={18} aria-hidden="true" /></Show>
              {view().phase === 'recording' ? '녹음 정지' : '녹음하기'}
            </button>
            <Show when={view().phase === 'recording'}><span class="talk-record-time" role="status">녹음 중 · {view().recordingSeconds} / 30초</span></Show>
          </div>
          <p class="talk-record-hint">{props.recorder.supported ? '최대 30초. 받아쓴 내용은 입력창에 추가돼요. 확인하고 보내주세요.' : '녹음을 지원하지 않는 브라우저예요. 텍스트로 입력해 주세요.'}</p>
          <div class="talk-actions">
            <button type="submit" class="talk-button talk-primary" disabled={busy() || !canSend(view())}>보내기</button>
            <button type="button" class="talk-button talk-secondary" disabled={busy()} onClick={() => finish.mutate()}>연습 마치기 · 보고서</button>
          </div>
        </form>
      </Show>
    </>}</Show>
    <div class="talk-status-row">
      <p role="status" aria-live="polite">{phaseLabel(view().phase)}</p>
      <Show when={busy()}><button type="button" class="talk-button talk-secondary" onClick={() => { controller.cancel(); recording.cancel(); }}>중단</button></Show>
    </div>
    <Show when={view().report}>{report => <ReportPanel report={report()} />}</Show>
  </main>;
}
