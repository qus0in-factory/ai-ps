import { For, Show, type JSX } from 'solid-js';
import { placementView } from '../../components/queens/placement-view.ts';
import {
  candidateView, feedbackView, SPOILER_SUMMARY, validationView,
} from '../../components/queens/generation-log-view.ts';
import type { GenerationEvent } from '../../../domain/queens/generation.ts';

function LogDetails(props: { summary: string; detail?: JSX.Element; spoiler?: string }) {
  return (
    <details>
      <summary>{props.summary}</summary>
      {props.detail}
      <Show when={props.spoiler}>
        {(spoiler) => (
          <>
            <p class="queens-spoiler-note">정답 좌표는 스포일러 방지를 위해 가려 두었습니다. 확인하려면 아래를 펼치세요.</p>
            <details class="queens-spoiler">
              <summary>{SPOILER_SUMMARY}</summary>
              <pre>{spoiler()}</pre>
            </details>
          </>
        )}
      </Show>
    </details>
  );
}

export function GenerationLog(props: { events: GenerationEvent[] }) {
  return (
    <Show when={props.events.length}>
      <section class="queens-log" aria-label="생성과 검증 진행 기록" aria-live="polite">
        <h2>진행 기록</h2>
        <ol><For each={props.events}>{(event) => (
          <li>
            <Show when={event.kind === 'attempt'}><strong>{event.kind === 'attempt' && `생성 ${event.attempt}회 · 재시도 ${event.retry}/10`}</strong></Show>
            <Show when={event.kind === 'placement'}>
              {(() => {
                if (event.kind !== 'placement') return null;
                const placement = placementView(event.solution);
                return (
                  <LogDetails summary={placement.summary} spoiler={placement.detail} />
                );
              })()}
            </Show>
            <Show when={event.kind === 'candidate'}>
              {(() => {
                if (event.kind !== 'candidate') return null;
                const view = candidateView(event.regions);
                return (
                  <LogDetails summary="영역 디자인 제안" detail={<pre>{view.detail}</pre>} spoiler={view.spoiler} />
                );
              })()}
            </Show>
            <Show when={event.kind === 'validation'}>
              {(() => {
                if (event.kind !== 'validation') return null;
                const view = validationView(event.report);
                return (
                  <LogDetails summary={view.summary} detail={<pre>{view.detail}</pre>} spoiler={view.spoiler} />
                );
              })()}
            </Show>
            <Show when={event.kind === 'feedback'}>
              {(() => {
                if (event.kind !== 'feedback') return null;
                const view = feedbackView(event.message);
                return (
                  <LogDetails summary="수정 피드백 전달" detail={<pre>{view.detail}</pre>} spoiler={view.spoiler} />
                );
              })()}
            </Show>
            <Show when={event.kind === 'complete'}><strong>생성 완료</strong></Show>
            <Show when={event.kind === 'stopped'}><span>{event.kind === 'stopped' && event.reason}</span></Show>
          </li>
        )}</For></ol>
      </section>
    </Show>
  );
}
