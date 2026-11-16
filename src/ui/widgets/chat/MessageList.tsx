import { createEffect, For, Show } from 'solid-js';
import type { ChatState } from '../../../domain/chat.ts';
import { MessageBubble } from '../../components/chat/MessageBubble.tsx';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { AgentTrace } from '../agent/AgentTrace.tsx';
import './MessageList.css';

export function MessageList(props: { state: ChatState }) {
  let bottom!: HTMLDivElement;
  createEffect(() => {
    props.state.messages;
    props.state.steps;
    props.state.pending;
    bottom?.scrollIntoView({ block: 'end' });
  });
  return (
    <section class="messages" role="log" aria-label="대화" aria-live="polite" aria-busy={props.state.pending}>
      <Show when={props.state.messages.length} fallback={<p class="empty">무엇이든 물어보세요.</p>}>
        <For each={props.state.messages}>{(message) => (
          <MessageBubble role={message.role}>
            <Show when={message.role === 'assistant'} fallback={<p class="user-text">{message.content}</p>}>
              <AgentTrace steps={message.steps ?? []} />
              <Show when={message.steps?.some((step) => step.kind === 'plan')}><h3 class="final-answer-label">최종 답변</h3></Show>
              <Markdown content={message.content} />
            </Show>
          </MessageBubble>
        )}</For>
      </Show>
      <Show when={props.state.pending || props.state.error}><AgentTrace steps={props.state.steps} pending={props.state.pending} /></Show>
      <Show when={props.state.pending && !props.state.steps.some((step) => step.kind === 'planning')}><p class="waiting">답변을 작성하고 있어요…</p></Show>
      <div ref={bottom} />
    </section>
  );
}
