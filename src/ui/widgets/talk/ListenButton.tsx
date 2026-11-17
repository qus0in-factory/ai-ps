import { LoaderCircle, Square, Volume2 } from 'lucide-solid';
import { Show } from 'solid-js';
import { canListen, type ListeningView } from '../../../app/talk/listening.ts';
export function ListenButton(props: { text: string; view: ListeningView; disabled?: boolean; onToggle(text: string): void }) {
  const active = () => props.view.text === props.text;
  const playing = () => active() && props.view.status === 'playing';
  const loading = () => active() && props.view.status === 'loading';
  return <div class="talk-listen">
    <button type="button" class="talk-button talk-secondary talk-listen-button"
      disabled={!canListen(props.text) || props.disabled} aria-pressed={playing()} aria-busy={loading()}
      title={!canListen(props.text) ? '400자를 넘는 문장은 들을 수 없어요.' : props.disabled ? '녹음을 마친 뒤 들을 수 있어요.' : undefined}
      onClick={() => props.onToggle(props.text)}>
      <Show when={loading()} fallback={<Show when={playing()} fallback={<Volume2 size={16} aria-hidden="true" />}><Square size={16} aria-hidden="true" /></Show>}><LoaderCircle size={16} aria-hidden="true" /></Show>
      {loading() ? '불러오는 중 · 취소' : playing() ? '정지' : '듣기'}
    </button>
    <Show when={playing()}><span class="talk-listen-status" role="status">재생 중</span></Show>
    <Show when={!canListen(props.text)}><small>400자 이하만 들을 수 있어요.</small></Show>
    <Show when={active() && props.view.error}><p class="talk-listen-error" role="alert">{props.view.error}</p></Show>
  </div>;
}
