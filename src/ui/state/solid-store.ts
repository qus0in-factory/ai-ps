import { createSignal, onCleanup } from 'solid-js';
import type { StoreApi } from 'zustand/vanilla';

/**
 * zustand(vanilla) 스토어를 Solid signal 로 구독한다.
 * 화면 프레임워크(Solid)와 상태 라이브러리(zustand)를 분리하려고 이 얇은 브리지만 둔다.
 * 선택 값이 바뀌지 않으면 signal 을 갱신하지 않는다(equals, 기본 Object.is).
 */
export function useStore<T, S>(
  store: StoreApi<T>,
  selector: (state: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
) {
  const [value, setValue] = createSignal(selector(store.getState()), { equals });
  const unsubscribe = store.subscribe((state) => setValue(() => selector(state)));
  onCleanup(unsubscribe);
  return value;
}
