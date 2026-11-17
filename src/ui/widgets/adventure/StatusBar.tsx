import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { GameState } from '../../../domain/adventure/types.ts';
import { AdventureAsset } from '../../components/adventure/AdventureAsset.tsx';
import { PixelBar } from '../../components/adventure/PixelBar.tsx';
import { compactFromIntersection } from '../../components/adventure/status-layout.ts';
import { statusView } from '../../components/adventure/status-view.ts';

const portraitAlts = { ok: '평상시의 노을', hurt: '지친 노을', cold: '추위에 떠는 노을' } as const;
const repairParts = [
  { key: 'lens', name: 'icon-lens', label: '렌즈', fallback: '렌즈' },
  { key: 'clockwork', name: 'icon-clockwork', label: '태엽', fallback: '태엽' },
  { key: 'oil', name: 'icon-oil', label: '등유', fallback: '등유' },
] as const;

export function StatusBar(props: { state: GameState }) {
  const view = () => statusView(props.state);
  // sticky 패널 바로 아래 센티널이 화면 밖으로 나가면 한 줄(compact)로 접는다.
  // scroll 리스너 없이 IntersectionObserver 하나만 쓰고, 해제는 onCleanup 이 맡는다.
  const [compact, setCompact] = createSignal(false);
  let sentinel: HTMLDivElement | undefined;
  onMount(() => {
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) setCompact(compactFromIntersection(entry));
    });
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });
  const repairs = (size: number) => repairParts.map((part) => (
    <span class="adv-repair" classList={{ 'adv-repair--done': view().repairs[part.key] }}
      title={`${part.label} ${view().repairs[part.key] ? '수리 완료' : '미수리'}`}>
      <AdventureAsset name={part.name} alt="" size={size} fallback={part.fallback} />
      <span class="adv-repair__label">{part.label}</span>
    </span>
  ));
  return (
    <>
      <header class="adv-status" classList={{ 'adv-status--compact': compact() }}>
        <Show when={!compact()} fallback={
          <>
            <AdventureAsset name={`portrait-${view().portrait}`} alt={portraitAlts[view().portrait]}
              size={32} fallback="노을" class="adv-status__portrait" />
            <span class="adv-status__when adv-status__when--compact">
              {view().dayLabel} {view().timeLabel}
            </span>
            <div class="adv-status__compact-bars">
              <PixelBar compact label="체력" value={props.state.stats.health} tone="health" />
              <PixelBar compact label="온기" value={props.state.stats.warmth} tone="warmth" />
              <PixelBar compact label="집중" value={props.state.stats.focus} tone="focus" />
            </div>
            <div class="adv-status__repairs adv-status__repairs--compact" aria-label="수리 부품">
              {repairs(18)}
            </div>
          </>
        }>
          <AdventureAsset name={`portrait-${view().portrait}`} alt={portraitAlts[view().portrait]}
            size={64} fallback="노을" class="adv-status__portrait" />
          <div class="adv-status__meta">
            <p class="adv-status__when">
              <strong>{view().dayLabel}</strong> · {view().timeLabel} · {view().weatherLabel}
            </p>
            <p class="adv-status__where">
              📍 {view().locationLabel}
              <span class="adv-chip">{view().shipLabel}</span>
            </p>
          </div>
          <div class="adv-status__bars">
            <PixelBar label="체력" value={props.state.stats.health} tone="health" />
            <PixelBar label="온기" value={props.state.stats.warmth} tone="warmth" />
            <PixelBar label="집중" value={props.state.stats.focus} tone="focus" />
          </div>
          <div class="adv-status__repairs" aria-label="수리 부품">
            {repairs(20)}
          </div>
        </Show>
      </header>
      <div class="adv-status__sentinel" ref={sentinel} aria-hidden="true" />
    </>
  );
}
