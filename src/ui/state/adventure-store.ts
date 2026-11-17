import { createStore, type StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  beginStart as beginStartView, beginTurn as beginTurnView, commit as commitView, fail as failView,
  initialState, reduceEvent, reset as resetView, restoreSession, restoredLog, type AdventureView,
} from '../../app/adventure/session-store.ts';
import type { AdventureEvent, AdventureSession } from '../../domain/adventure/types.ts';

/**
 * /adventure 클라이언트 상태.
 *
 * 역할 분담(설계 §5):
 * - zustand(vanilla): 세션·로그·스트림·phase 를 보관하고 localStorage 에 세션만 저장한다.
 * - app/adventure/session-store.ts: 이벤트를 화면 상태로 접는 순수 리듀서(reduceEvent). UI 프레임워크에 의존하지 않는다.
 * - @tanstack/solid-query: mutation 의 pending·error·취소 생명주기만 맡는다. 스트림은 query 결과가 아니라
 *   onEvent 콜백으로 이 스토어에 흘러 들어온다(서버가 무상태라 조회 query 는 두지 않는다).
 */
export type AdventureStoreActions = {
  beginStart(): void;
  beginTurn(): void;
  /** request 를 주면 그 세대의 이벤트만 반영한다(늦게 도착한 이전 요청 무시). */
  applyEvent(event: AdventureEvent, request?: number): void;
  commit(session: AdventureSession, request?: number): void;
  fail(reason: string, request?: number): void;
  reset(): void;
};

export type AdventureStoreState = AdventureView & AdventureStoreActions;
/** zustand persist 뮤테이터의 타입 표기 문제로 StoreApi 로 좁혀 쓴다(런타임 동일). */
export type AdventureStore = StoreApi<AdventureStoreState>;

export const ADVENTURE_STORAGE_KEY = 'ai-ps.adventure.v1';

export function createAdventureStore(storageKey: string = ADVENTURE_STORAGE_KEY): AdventureStore {
  return createStore<AdventureStoreState>()(
    persist(
      (set, get) => ({
        ...initialState(),
        beginStart: () => set(beginStartView(get())),
        beginTurn: () => set(beginTurnView(get())),
        applyEvent: (event, request) => set(reduceEvent(get(), event, request)),
        commit: (session, request) => set(commitView(get(), session, request)),
        fail: (reason, request) => set(failView(get(), reason, request)),
        // 새 게임도 요청 세대를 올려, 진행 중이던 이전 요청의 늦은 결과를 무시한다.
        reset: () => set({ ...resetView(), request: get().request + 1 }),
      }),
      {
        name: storageKey,
        version: 1,
        storage: createJSONStorage(() => localStorage),
        // 화면 로그·스트림은 저장하지 않는다. 새로 고치면 세션만 복원된다.
        partialize: (state) => ({ session: state.session }),
        // 손상되었거나 스키마가 어긋난 세션은 버린다. statusView 가 즉시 throw 하는 것을 막는다.
        // 복원 시에는 recent 의 지난 서술을 로그로 채워, 빈 상자 대신 이어서 읽을 수 있게 한다.
        merge: (persisted, current) => {
          const saved = (persisted as { session?: unknown } | undefined)?.session;
          const restored = restoreSession(saved);
          return {
            ...current,
            session: restored,
            log: restored ? restoredLog(restored) : [],
            restored: Boolean(restored && restored.recent.length),
          };
        },
      },
    ),
  ) as unknown as AdventureStore;
}
