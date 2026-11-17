import { render } from 'solid-js/web';
import { createChat } from './app/chat.ts';
import { createGenerationController } from './app/queens/generation-store.ts';
import { createHttpQueensGenerator } from './infra/http-queens-generator.ts';
import { createHttpChat } from './infra/http-chat.ts';
import { createHttpAdventure } from './infra/http-adventure.ts';
import { createLocalChatMemory } from './infra/local-chat-memory.ts';
import { createAdventureStore } from './ui/state/adventure-store.ts';
import { createTalkStore } from './ui/state/talk-store.ts';
import { createBrowserAudioPlayer } from './infra/browser-audio.ts';
import { createBrowserRecorder } from './infra/media-recorder.ts';
import { createHttpTalk } from './infra/http-talk.ts';
import { App } from './ui/App.tsx';
import './ui/styles/global.css';

const chat = createChat(createHttpChat(), createLocalChatMemory());
const queens = createGenerationController(createHttpQueensGenerator());
const adventureStore = createAdventureStore();
const adventure = createHttpAdventure();
const talkStore = createTalkStore();
const talk = createHttpTalk();
const recorder = createBrowserRecorder();
const audioPlayer = createBrowserAudioPlayer();
render(() => (
  <App chat={chat} queens={queens} adventure={adventure} adventureStore={adventureStore} talk={talk} talkStore={talkStore} recorder={recorder} audioPlayer={audioPlayer} />
), document.getElementById('root')!);
