import type { ChatController } from '../../app/chat.ts';
import { ChatWidget } from '../widgets/chat/ChatWidget.tsx';

export function ChatPage(props: { chat: ChatController }) {
  return <ChatWidget chat={props.chat} />;
}
