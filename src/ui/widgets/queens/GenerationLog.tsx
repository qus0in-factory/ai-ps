import { For, Show } from 'solid-js';
import type { GenerationEvent } from '../../../domain/queens/generation.ts';

export function GenerationLog(props: { events: GenerationEvent[] }) {
  return (
    <Show when={props.events.length}>
      <section class="queens-log" aria-label="생성과 검증 진행 기록" aria-live="polite">
        <h2>진행 기록</h2>
        <ol><For each={props.events}>{(event) => (
          <li>
            <Show when={event.kind === 'attempt'}><strong>{event.kind === 'attempt' && `생성 ${event.attempt}회 · 재시도 ${event.retry}/10`}</strong></Show>
            <Show when={event.kind === 'placement'}>
              <span>{event.kind === 'placement' && `정답 배치 생성 · ${event.solution.map((q) => `(${q.row}, ${q.column})`).join(', ')}`}</span>
            </Show>
            <Show when={event.kind === 'candidate'}>
              <details><summary>영역 디자인 제안</summary><pre>{event.kind === 'candidate' && JSON.stringify(event.regions, null, 2)}</pre></details>
            </Show>
            <Show when={event.kind === 'validation'}>
              <details><summary>{event.kind === 'validation' && (event.report.valid ? '검증 통과 · 정답 1개' : `검증 실패 · ${event.report.issues.map(issue => issue.code).join(', ')}`)}</summary>
                <pre>{event.kind === 'validation' && JSON.stringify(event.report, null, 2)}</pre>
              </details>
            </Show>
            <Show when={event.kind === 'feedback'}><details><summary>수정 피드백 전달</summary><pre>{event.kind === 'feedback' && event.message}</pre></details></Show>
            <Show when={event.kind === 'complete'}><strong>생성 완료</strong></Show>
            <Show when={event.kind === 'stopped'}><span>{event.kind === 'stopped' && event.reason}</span></Show>
          </li>
        )}</For></ol>
      </section>
    </Show>
  );
}
