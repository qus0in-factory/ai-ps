import type { TalkClient, TalkPhase, TalkSession, TutorReply, TutorGender, TutorMood } from '../../domain/talk/types.ts';
import type { Result } from '../../domain/chat.ts';
import { createSession, normalizeSession, canAddTurn, LIMITS, isTutorGender, record, text } from '../../domain/talk/session.ts';

export const TALK_LIMITS = LIMITS;
export interface TalkView {
  selectedTutor: TutorGender;
  session: TalkSession | null;
  phase: TalkPhase;
  learnerText: string;
  report?: string;
  error: string;
}
export function initialState(): TalkView { return { selectedTutor: 'f', session: null, phase: 'idle', learnerText: '', report: undefined, error: '' }; }
export function restoreSession(value: unknown): TalkSession | null {
  const session = normalizeSession(value);
  return session?.turns.length ? session : null;
}
/** Local completion metadata stays outside the session sent to the BFF. */
export function persistTalkView(view: TalkView) {
  const finished = view.phase === 'ended';
  return { session: view.session, finished, report: finished ? view.report : undefined };
}
export function restoreTalkView(value: unknown): TalkView {
  const initial = initialState();
  if (!record(value)) return initial;
  const session = restoreSession(value.session);
  if (!session) return initial;
  const view = { ...initial, session, selectedTutor: session.tutor };
  // Older snapshots have no completion flag and represent resumable sessions.
  if (value.finished !== true) return view;
  const report = text(value.report, LIMITS.report) ? value.report : undefined;
  return { ...view, phase: 'ended', report,
    error: report ? '' : '저장된 보고서를 읽지 못했습니다. 새 연습을 시작해 주세요.' };
}
export const isBusy = (view: TalkView) => view.phase === 'thinking' || view.phase === 'reporting';
export function activeTutorMood(view: TalkView): TutorMood {
  return isBusy(view) ? 'think' : view.session?.turns.at(-1)?.tutor.mood ?? 'neutral';
}
export const canSend = (view: TalkView) => !isBusy(view) && view.phase !== 'ended' && !!view.session && canAddTurn(view.session, view.learnerText);
export const atLimit = (view: TalkView) => !!view.session && !canAddTurn(view.session, 'x');
export function beginTurn(view: TalkView, learnerText = view.learnerText): TalkView { return { ...view, phase: 'thinking', learnerText, error: '' }; }
export function fail(view: TalkView, error: string): TalkView { return { ...view, phase: view.report ? 'ended' : 'idle', error }; }
export function setReport(view: TalkView, report: string): TalkView { return { ...view, report, phase: 'ended', error: '' }; }
export function addTurn(view: TalkView, learner: string, tutor: TutorReply): TalkView {
  return { ...view, session: { version: 1, tutor: view.session?.tutor ?? view.selectedTutor, turns: [...(view.session?.turns ?? []), { learner, tutor }] }, learnerText: '', phase: 'idle', error: '' };
}

interface ViewStore { getState(): TalkView; setState(view: TalkView): void }
/** Mutations call these use cases; only completed responses change the persisted session. */
export function createTalkController(client: TalkClient, store: ViewStore) {
  let controller: AbortController | undefined;
  async function run(kind: 'start' | 'send' | 'report', learner?: string): Promise<Result<void>> {
    const view = store.getState();
    if (isBusy(view)) return { ok: false, reason: '현재 요청이 끝난 뒤 다시 시도하세요.' };
    if (view.phase === 'ended') return { ok: false, reason: '새 연습을 시작하세요.' };
    if (kind === 'start' ? !!view.session : !view.session?.turns.length) return { ok: false, reason: '연습 상태를 확인해 주세요.' };
    const session = view.session ?? createSession(view.selectedTutor);
    const input = learner?.trim();
    if (kind === 'send' && !canAddTurn(session, input)) {
      const reason = atLimit(view) ? '연습을 마치고 보고서를 받으세요.' : '1~500자의 텍스트를 입력하세요.';
      store.setState(fail(view, reason)); return { ok: false, reason };
    }
    controller = new AbortController();
    const signal = controller.signal;
    store.setState(kind === 'report' ? { ...view, phase: 'reporting', error: '' } : beginTurn(view, learner ?? ''));
    try {
      if (kind === 'report') {
        const result = await client.report(session, signal);
        if (signal.aborted) throw new Error('cancelled');
        if (!result.ok) { store.setState(fail(store.getState(), result.reason)); return result; }
        store.setState(setReport(store.getState(), result.value));
      } else {
        const result = await client.respond(session, input, signal);
        if (signal.aborted) throw new Error('cancelled');
        if (!result.ok) { store.setState(fail(store.getState(), result.reason)); return result; }
        store.setState(addTurn(store.getState(), input ?? '', result.value));
      }
      return { ok: true, value: undefined };
    } catch {
      const reason = signal.aborted ? '요청을 중단했습니다. 대화 기록은 그대로예요.' : '요청을 처리하지 못했습니다. 다시 시도해 주세요.';
      store.setState(fail(store.getState(), reason)); return { ok: false, reason };
    } finally { controller = undefined; }
  }
  return {
    selectTutor: (tutor: TutorGender) => {
      const view = store.getState();
      if (!view.session && !isBusy(view) && isTutorGender(tutor)) store.setState({ ...view, selectedTutor: tutor });
    },
    start: () => run('start'), send: (text: string) => run('send', text), finish: () => run('report'),
    cancel: () => controller?.abort(),
    reset: () => { if (!isBusy(store.getState())) store.setState(initialState()); },
  };
}
