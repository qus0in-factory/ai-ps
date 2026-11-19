import { Route, Router, useLocation, useNavigate, type RouteSectionProps } from '@solidjs/router';
import { createEffect, onMount } from 'solid-js';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { ChatController } from '../app/chat.ts';
import type { QueensGenerationController } from '../app/queens/generation-store.ts';
import type { AdventureClient } from '../domain/adventure/types.ts';
import type { AdventureStore } from './state/adventure-store.ts';
import { QueensPage } from './pages/QueensPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { AdventurePage } from './pages/AdventurePage.tsx';
import { IndexPage } from './pages/IndexPage.tsx';
import { TalkPage } from './pages/TalkPage.tsx';
import { ResearchPage } from './pages/ResearchPage.tsx';
import { applyRouteMeta } from './route-meta.ts';
import { StatsPage } from './pages/StatsPage.tsx';
import type { StatsClient } from './pages/stats-view.ts';
import type { ResearchClient } from './widgets/research/types.ts';
import type { AudioPlayer } from '../domain/talk/listening.ts';
import type { Recorder } from '../domain/talk/recording.ts';
import type { TalkClient } from '../domain/talk/types.ts';
import type { TalkStore } from './state/talk-store.ts';

// 서버 조회 query 는 없고 mutation 만 쓴다(무상태 서버). 재시도는 비용·비멱등 때문에 끈다.
const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });

// 옛 경로(/queen)는 /queens 로 보낸다. API 별칭은 두지 않는다.
function RedirectToQueens() {
  const navigate = useNavigate();
  onMount(() => navigate('/queens', { replace: true }));
  return null;
}

// 라우트가 바뀔 때마다 문서 제목·설명을 route-meta 표대로 맞춘다(전 라우트 공통, 한 곳).
function RouteMeta(props: RouteSectionProps) {
  const location = useLocation();
  createEffect(() => applyRouteMeta(document, location.pathname));
  return props.children;
}

export function App(props: {
  chat: ChatController;
  queens: QueensGenerationController;
  adventure: AdventureClient;
  adventureStore: AdventureStore;
  recorder: Recorder;
  audioPlayer: AudioPlayer;
  talk: TalkClient;
  talkStore: TalkStore;
  research: ResearchClient;
  stats: StatsClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <Router root={RouteMeta}>
        <Route path="/" component={IndexPage} />
        <Route path="/queens" component={() => <QueensPage queens={props.queens} />} />
        <Route path="/queen" component={RedirectToQueens} />
        <Route path="/chat" component={() => <ChatPage chat={props.chat} />} />
        <Route path="/talk" component={() => <TalkPage audioPlayer={props.audioPlayer} recorder={props.recorder} client={props.talk} store={props.talkStore} />} />
        <Route path="/research" component={() => <ResearchPage client={props.research} />} />
        <Route path="/stats" component={() => <StatsPage client={props.stats} />} />
        <Route path="/adventure" component={() => (
          <AdventurePage client={props.adventure} store={props.adventureStore} />
        )} />
      </Router>
    </QueryClientProvider>
  );
}
