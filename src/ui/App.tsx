import { Route, Router } from '@solidjs/router';
import type { ChatController } from '../app/chat.ts';
import type { QueensGenerationController } from '../app/queens/generation-store.ts';
import { QueenPage } from './pages/QueenPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { IndexPage } from './pages/IndexPage.tsx';

export function App(props: { chat: ChatController; queen: QueensGenerationController }) {
  return (
    <Router>
      <Route path="/" component={IndexPage} />
      <Route path="/queen" component={() => <QueenPage queen={props.queen} />} />
      <Route path="/chat" component={() => <ChatPage chat={props.chat} />} />
    </Router>
  );
}
