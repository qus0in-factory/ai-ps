import { render } from 'solid-js/web';
import { createChat } from './app/chat.ts';
import { createHttpChat } from './infra/http-chat.ts';
import { Chat } from './ui/Chat.tsx';

const chat = createChat(createHttpChat());
render(() => <Chat chat={chat} />, document.getElementById('root')!);
