import { createSignal, Show } from 'solid-js';

/**
 * 8bit 에셋 한 장. 파일이 아직 없거나 깨져도 레이아웃이 무너지지 않게 대체 블록/글자로 바꾼다.
 * public/adventure/ 에 파일이 추가되면 같은 경로로 그대로 표시된다.
 */
export function AdventureAsset(props: {
  name: string;
  alt: string;
  size: number;
  fallback: string;
  class?: string;
}) {
  const [broken, setBroken] = createSignal(false);
  return (
    <span class={`asset ${props.class ?? ''}`} classList={{ 'asset--fallback': broken() }}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}>
      <Show when={!broken()} fallback={<span class="asset__fallback" aria-hidden="true">{props.fallback}</span>}>
        <img src={`/adventure/${props.name}.png`} alt={props.alt} width={props.size} height={props.size}
          loading="lazy" onError={() => setBroken(true)} />
      </Show>
    </span>
  );
}
