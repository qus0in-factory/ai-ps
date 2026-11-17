import { For, Show } from 'solid-js';
import { generationEventText } from '../../components/queens/generation-log-view.ts';
import type { GenerationEvent } from '../../../domain/queens/generation.ts';

export function GenerationLog(props: { events: GenerationEvent[] }) {
  return (
    <Show when={props.events.length}>
      <section class="queens-log" aria-label="생성과 검증 진행 기록" aria-live="polite">
        <h2>진행 기록</h2>
        <ol><For each={props.events}>{event => <li>{generationEventText(event)}</li>}</For></ol>
      </section>
    </Show>
  );
}
