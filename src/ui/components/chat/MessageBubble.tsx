import type { JSX } from 'solid-js';
import type { ChatMessage } from '../../../domain/chat.ts';
import './MessageBubble.css';

export function MessageBubble(props: { role: ChatMessage['role']; children: JSX.Element }) {
  return (
    <article class={`message-bubble ${props.role}`}>
      <span class="role">{props.role === 'user' ? '나' : 'AI'}</span>
      {props.children}
    </article>
  );
}
