import { createStore, type StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { initialState, restoreSession, type TalkView } from '../../app/talk/session-store.ts';

export type TalkStore = StoreApi<TalkView>;
/** Match the app's zustand persistence convention; transitions live in app/talk. */
export function createTalkStore(key = 'ai-ps.talk.v1', storage?: StateStorage): TalkStore {
  return createStore<TalkView>()(persist(() => initialState(), {
    name: key, version: 1,
    storage: createJSONStorage(() => storage ?? localStorage),
    partialize: view => ({ session: view.session }),
    merge: (persisted, current) => ({ ...current, session: restoreSession((persisted as { session?: unknown } | undefined)?.session) }),
  }));
}
