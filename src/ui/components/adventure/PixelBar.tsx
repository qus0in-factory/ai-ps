import { For } from 'solid-js';
import { barCells } from './status-view.ts';
import './adventure-components.css';

/** 8칸 픽셀 스탯 바. 이미지 없이 CSS 블록으로만 그리고, 값은 숫자·meter 로도 읽힌다. */
export function PixelBar(props: { label: string; value: number; tone: 'health' | 'warmth' | 'focus' }) {
  const filled = () => barCells(props.value);
  return (
    <div class={`pixel-bar pixel-bar--${props.tone}`} role="meter" aria-label={props.label}
      aria-valuenow={props.value} aria-valuemin={0} aria-valuemax={100}>
      <span class="pixel-bar__label">{props.label}</span>
      <span class="pixel-bar__track" aria-hidden="true">
        <For each={Array.from({ length: 8 }, (_, index) => index < filled())}>
          {(on) => <span class="pixel-bar__cell" classList={{ 'pixel-bar__cell--on': on }} />}
        </For>
      </span>
      <span class="pixel-bar__value" aria-hidden="true">{props.value}</span>
    </div>
  );
}
