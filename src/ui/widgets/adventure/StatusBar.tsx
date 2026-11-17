import type { GameState } from '../../../domain/adventure/types.ts';
import { AdventureAsset } from '../../components/adventure/AdventureAsset.tsx';
import { PixelBar } from '../../components/adventure/PixelBar.tsx';
import { statusView } from '../../components/adventure/status-view.ts';

const portraitAlts = { ok: '평상시의 노을', hurt: '지친 노을', cold: '추위에 떠는 노을' } as const;
const repairParts = [
  { key: 'lens', name: 'icon-lens', label: '렌즈', fallback: '렌즈' },
  { key: 'clockwork', name: 'icon-clockwork', label: '태엽', fallback: '태엽' },
  { key: 'oil', name: 'icon-oil', label: '등유', fallback: '등유' },
] as const;

export function StatusBar(props: { state: GameState }) {
  const view = () => statusView(props.state);
  return (
    <header class="adv-status">
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
        {repairParts.map((part) => (
          <span class="adv-repair" classList={{ 'adv-repair--done': view().repairs[part.key] }}
            title={`${part.label} ${view().repairs[part.key] ? '수리 완료' : '미수리'}`}>
            <AdventureAsset name={part.name} alt="" size={20} fallback={part.fallback} />
            <span class="adv-repair__label">{part.label}</span>
          </span>
        ))}
      </div>
    </header>
  );
}
