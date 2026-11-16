import { createSignal, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import type { ChatController } from '../../../app/chat.ts';
import { ChatComposer } from '../../components/chat/ChatComposer.tsx';
import { MessageList } from './MessageList.tsx';
import './ChatWidget.css';

export function ChatWidget(props: { chat: ChatController }) {
  const [state, setState] = createSignal(props.chat.getState());
  onCleanup(props.chat.subscribe(setState));
  return (
    <main class="chat-widget">
      <header class="chat-header"><A href="/" class="home-link">← 홈</A><h1>Chat</h1></header>
      <MessageList state={state()} />
      <ChatComposer draft={state().draft} pending={state().pending} error={state().error}
        onInput={(draft) => props.chat.setDraft(draft)} onSend={() => props.chat.send()} />
    </main>
  );
}
