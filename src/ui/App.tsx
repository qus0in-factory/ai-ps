import { Route, Router } from '@solidjs/router';
import type { ChatController } from '../app/chat.ts';
import { ChatPage } from './pages/ChatPage.tsx';
import { IndexPage } from './pages/IndexPage.tsx';

export function App(props: { chat: ChatController }) {
  return (
    <Router>
      <Route path="/" component={IndexPage} />
      <Route path="/chat" component={() => <ChatPage chat={props.chat} />} />
    </Router>
  );
}
