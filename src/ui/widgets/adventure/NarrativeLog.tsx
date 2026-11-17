import { createEffect, For, Show } from 'solid-js';
import type { AdventureLogEntry, StreamingTurn } from '../../../app/adventure/session-store.ts';
import { deltaLine, diceLine, isIntro, streamingView } from '../../components/adventure/narrative-view.ts';

export function NarrativeLog(props: { log: AdventureLogEntry[]; streaming?: StreamingTurn; restored?: boolean }) {
  const live = () => streamingView(props.streaming);
  // 페이지 스크롤을 쓰므로, 새 서술이 오면 마지막 지점만 화면 안으로 맞춘다(내부 스크롤 없음).
  let end: HTMLDivElement | undefined;
  let mounted = false;
  let lastCount = 0;
  let lastText = '';
  createEffect(() => {
    const count = props.log.length;
    const text = props.streaming?.text ?? '';
    if (!mounted) { mounted = true; lastCount = count; lastText = text; return; }
    if (count === lastCount && text === lastText) return;
    lastCount = count;
    lastText = text;
    if (typeof end?.scrollIntoView === 'function') end.scrollIntoView({ block: 'nearest' });
  });
  return (
    <section class="adv-log" role="log" aria-live="polite" aria-label="모험 서술">
      <Show when={props.restored && props.log.length}>
        <p class="adv-log__note">지난 이야기</p>
      </Show>
      <Show when={!props.log.length && !live().visible}>
        <p class="adv-log__note">이어서 진행합니다. 다음 행동을 입력하세요.</p>
      </Show>
      <For each={props.log}>{(entry) => (
        <article class="adv-log__entry" classList={{
          'adv-log__entry--invalid': Boolean(entry.invalid),
          'adv-log__entry--intro': isIntro(entry),
        }}>
          <Show when={!isIntro(entry)}><p class="adv-log__action">▶ {entry.action}</p></Show>
          <For each={entry.dice}>{(dice) => (
            <p class="adv-log__dice" role="status">{diceLine(dice)}</p>
          )}</For>
          <Show when={entry.narrative}><p class="adv-log__text">{entry.narrative}</p></Show>
          <Show when={entry.invalid}><p class="adv-log__invalid">서술을 받지 못했어요. 다른 행동을 입력해 보세요.</p></Show>
          <Show when={!isIntro(entry) && entry.applied}>{(applied) => (
            <p class="adv-log__delta">{deltaLine(applied())}</p>
          )}</Show>
        </article>
      )}</For>
      <Show when={live().visible}>
        <article class="adv-log__entry adv-log__entry--live">
          <Show when={live().action}><p class="adv-log__action">▶ {live().action}</p></Show>
          <For each={live().dice}>{(dice) => (
            <p class="adv-log__dice" role="status">{diceLine(dice)}</p>
          )}</For>
          <p class="adv-log__text">{live().text}<span class="adv-caret" aria-hidden="true">▌</span></p>
        </article>
      </Show>
      <div ref={end} class="adv-log__end" aria-hidden="true" />
    </section>
  );
}
