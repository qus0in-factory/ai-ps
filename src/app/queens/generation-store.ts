import type { GenerationState, QueensGenerator } from '../../domain/queens/generation.ts';

export function createGenerationController(generator: QueensGenerator) {
  let state: GenerationState = { size: 5, pending: false, events: [], error: '' };
  const listeners = new Set<(state: GenerationState) => void>();
  const update = (patch: Partial<GenerationState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener(state));
  };
  return {
    getState: () => state,
    subscribe(listener: (state: GenerationState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setSize(size: number) {
      if (state.pending || !Number.isInteger(size) || size < 5 || size > 9) return;
      update({ size, generated: undefined, events: [], error: '' });
    },
    async generate() {
      if (state.pending) return;
      update({ pending: true, generated: undefined, events: [], error: '' });
      try {
        const result = await generator.generate(state.size, event => update({ events: [...state.events, event] }));
        if (result.ok) update({ generated: result.value });
        else update({ error: result.reason });
      } catch {
        update({ error: '퍼즐 생성 중 오류가 발생했습니다. 다시 시도해주세요.' });
      } finally {
        update({ pending: false });
      }
    },
  };
}
export type QueensGenerationController = ReturnType<typeof createGenerationController>;
