import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import type { ChatController } from '../app/chat.ts';
import { renderMarkdown } from './markdown.ts';
import './style.css';

export function Chat(props: { chat: ChatController }) {
  const [state, setState] = createSignal(props.chat.getState());
  onCleanup(props.chat.subscribe(setState));
  let bottom!: HTMLDivElement;
  let textarea!: HTMLTextAreaElement;

  createEffect(() => {
    state().messages;
    state().pending;
    bottom.scrollIntoView({ block: 'end' });
  });

  async function send(event: SubmitEvent) {
    event.preventDefault();
    await props.chat.send();
    textarea.focus();
  }

  return (
    <main>
      <header><h1>Chat</h1></header>
      <section class="messages" role="log" aria-label="대화" aria-live="polite" aria-busy={state().pending}>
        <Show when={state().messages.length} fallback={<p class="empty">무엇이든 물어보세요.</p>}>
          <For each={state().messages}>{(message) => (
            <article class={message.role}>
              <span class="role">{message.role === 'user' ? '나' : 'AI'}</span>
              <Show when={message.role === 'assistant'} fallback={<p>{message.content}</p>}>
                <div class="markdown" innerHTML={renderMarkdown(message.content)} />
              </Show>
            </article>
          )}</For>
        </Show>
        <Show when={state().pending}><p class="waiting">답변을 작성하고 있어요…</p></Show>
        <div ref={bottom} />
      </section>
      <footer>
        <Show when={state().error}><p class="error" role="alert">{state().error}</p></Show>
        <form onSubmit={send}>
          <textarea
            ref={textarea}
            aria-label="메시지"
            placeholder="메시지를 입력하세요"
            rows={2}
            value={state().draft}
            readOnly={state().pending}
            onInput={(event) => props.chat.setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={state().pending || !state().draft.trim()}>전송</button>
        </form>
      </footer>
    </main>
  );
}
