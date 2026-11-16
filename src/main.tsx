import { render } from 'solid-js/web';
import { createChat } from './app/chat.ts';
import { createHttpChat } from './infra/http-chat.ts';
import { createLocalChatMemory } from './infra/local-chat-memory.ts';
import { Chat } from './ui/Chat.tsx';

const chat = createChat(createHttpChat(), createLocalChatMemory());
render(() => <Chat chat={chat} />, document.getElementById('root')!);
