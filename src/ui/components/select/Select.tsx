import { ChevronDown } from 'lucide-solid';
import { For } from 'solid-js';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
}

export function Select(props: {
  label: string;
  value: string | number;
  options: readonly SelectOption[];
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const disabled = () => Boolean(props.disabled);
  return (
    <span class="select" classList={{ 'select--disabled': disabled() }}>
      <select class="select__control" aria-label={props.label} disabled={disabled()}
        value={String(props.value)} onChange={(event) => props.onChange?.(event.currentTarget.value)}>
        <For each={props.options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
      </select>
      <ChevronDown class="select__icon" size={16} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}
