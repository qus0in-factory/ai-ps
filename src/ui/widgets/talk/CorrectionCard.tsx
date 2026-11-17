import { Show } from 'solid-js';
import type { TutorReply } from '../../../domain/talk/types.ts';
export function CorrectionCard(props: { tutor: TutorReply }) {
  return <Show when={props.tutor.correction || props.tutor.betterExpression}>
    <aside class="talk-correction" aria-label="표현 피드백">
      <Show when={props.tutor.correction}><p><strong>교정</strong> {props.tutor.correction}</p></Show>
      <Show when={props.tutor.betterExpression}><p><strong>다른 표현</strong> <span lang="ja">{props.tutor.betterExpression}</span></p></Show>
    </aside>
  </Show>;
}
