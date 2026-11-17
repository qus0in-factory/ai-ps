import { Route, Router, useNavigate } from '@solidjs/router';
import { onMount } from 'solid-js';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { ChatController } from '../app/chat.ts';
import type { QueensGenerationController } from '../app/queens/generation-store.ts';
import type { AdventureClient } from '../domain/adventure/types.ts';
import type { AdventureStore } from './state/adventure-store.ts';
import { QueensPage } from './pages/QueensPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { AdventurePage } from './pages/AdventurePage.tsx';
import { IndexPage } from './pages/IndexPage.tsx';

// 서버 조회 query 는 없고 mutation 만 쓴다(무상태 서버). 재시도는 비용·비멱등 때문에 끈다.
const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });

// 옛 경로(/queen)는 /queens 로 보낸다. API 별칭은 두지 않는다.
function RedirectToQueens() {
  const navigate = useNavigate();
  onMount(() => navigate('/queens', { replace: true }));
  return null;
}

export function App(props: {
  chat: ChatController;
  queens: QueensGenerationController;
  adventure: AdventureClient;
  adventureStore: AdventureStore;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Route path="/" component={IndexPage} />
        <Route path="/queens" component={() => <QueensPage queens={props.queens} />} />
        <Route path="/queen" component={RedirectToQueens} />
        <Route path="/chat" component={() => <ChatPage chat={props.chat} />} />
        <Route path="/adventure" component={() => (
          <AdventurePage client={props.adventure} store={props.adventureStore} />
        )} />
      </Router>
    </QueryClientProvider>
  );
}
