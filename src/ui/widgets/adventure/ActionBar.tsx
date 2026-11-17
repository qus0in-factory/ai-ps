import { createSignal, Show } from 'solid-js';
import { displayName, locationOptions } from '../../components/adventure/labels.ts';
import { Select } from '../../components/select/Select.tsx';
import type { LocationId } from '../../../domain/adventure/types.ts';

const quickActions = [
  { label: '둘러보기', action: '주변을 둘러본다' },
  { label: '쉬기', action: '잠시 쉰다' },
  { label: '숙소로', action: '숙소로 돌아간다' },
] as const;

export function ActionBar(props: {
  disabled: boolean;
  inventory: string[];
  onAction: (action: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = createSignal('');
  const [destination, setDestination] = createSignal<LocationId>('quarters');
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const action = text().trim();
    if (!action || props.disabled) return;
    props.onAction(action);
    setText('');
  };
  const move = (value: string) => {
    const location = value as LocationId;
    setDestination(location);
    setText(`${displayName(location)}에 간다`);
  };
  return (
    <div class="adv-actionbar">
      <Show when={props.inventory.length}>
        <p class="adv-inventory" aria-label="인벤토리">
          {props.inventory.map((item) => <span class="adv-inventory__chip">{displayName(item)}</span>)}
        </p>
      </Show>
      <div class="adv-quick">
        {quickActions.map((quick) => (
          <button type="button" class="adv-quick__button" disabled={props.disabled}
            onClick={() => setText(quick.action)}>{quick.label}</button>
        ))}
        <Select label="이동할 장소" value={destination()} options={locationOptions} disabled={props.disabled}
          onChange={move} />
      </div>
      <form class="adv-input" onSubmit={submit}>
        <input aria-label="행동 입력" type="text" maxlength={200} placeholder="무엇을 할까요?"
          value={text()} disabled={props.disabled}
          onInput={(event) => setText(event.currentTarget.value)} />
        <button type="submit" disabled={props.disabled || !text().trim()}>보내기</button>
        <Show when={props.disabled}>
          <button type="button" class="adv-input__stop" onClick={props.onStop}>중단</button>
        </Show>
      </form>
      <Show when={props.disabled}>
        <p class="adv-input__note" role="status">모델이 장면을 쓰는 중입니다. 끝나면 입력할 수 있어요.</p>
      </Show>
    </div>
  );
}
