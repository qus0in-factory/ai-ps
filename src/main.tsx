import { render } from 'solid-js/web';
import { createChat } from './app/chat.ts';
import { createHttpChat } from './infra/http-chat.ts';
import { createLocalChatMemory } from './infra/local-chat-memory.ts';
import { App } from './ui/App.tsx';
import './ui/styles/global.css';

const chat = createChat(createHttpChat(), createLocalChatMemory());
render(() => <App chat={chat} />, document.getElementById('root')!);
