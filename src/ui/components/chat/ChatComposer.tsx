import { Show } from 'solid-js';
import './ChatComposer.css';

export function ChatComposer(props: {
  draft: string; pending: boolean; error: string;
  onInput: (draft: string) => void; onSend: () => Promise<void>;
}) {
  let textarea!: HTMLTextAreaElement;
  async function send(event: SubmitEvent) {
    event.preventDefault();
    try { await props.onSend(); }
    finally { textarea.focus(); }
  }
  return (
    <footer class="chat-composer">
      <Show when={props.error}><p class="error" role="alert">{props.error}</p></Show>
      <form onSubmit={send}>
        <textarea
          ref={textarea} aria-label="메시지" placeholder="메시지를 입력하세요" rows={2}
          value={props.draft} readOnly={props.pending}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={props.pending || !props.draft.trim()}>전송</button>
      </form>
    </footer>
  );
}
