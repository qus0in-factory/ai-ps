import { For, Show } from 'solid-js';
import type { TalkTurn } from '../../../domain/talk/types.ts';
import { CorrectionCard } from './CorrectionCard.tsx';
export function TranscriptLog(props: { turns: TalkTurn[] }) {
  return <section class="talk-log" role="log" aria-live="polite" aria-label="일본어 대화 기록">
    <For each={props.turns}>{turn => <article class="talk-turn">
      <Show when={turn.learner}>
        <div class="talk-message talk-learner"><span class="talk-speaker">나</span><p lang="ja">{turn.learner}</p></div>
      </Show>
      <CorrectionCard tutor={turn.tutor} />
      <div class="talk-message talk-tutor"><span class="talk-speaker">{turn.learner ? '튜터' : '튜터의 인사'}</span><p lang="ja">{turn.tutor.reply}</p></div>
    </article>}</For>
  </section>;
}
