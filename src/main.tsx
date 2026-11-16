import { render } from 'solid-js/web';
import { createChat } from './app/chat.ts';
import { createGenerationController } from './app/queens/generation-store.ts';
import { createHttpQueensGenerator } from './infra/http-queens-generator.ts';
import { createHttpChat } from './infra/http-chat.ts';
import { createLocalChatMemory } from './infra/local-chat-memory.ts';
import { App } from './ui/App.tsx';
import './ui/styles/global.css';

const chat = createChat(createHttpChat(), createLocalChatMemory());
const queen = createGenerationController(createHttpQueensGenerator());
render(() => <App chat={chat} queen={queen} />, document.getElementById('root')!);
