import type { AdventureEvent, AdventureSession, AppliedChanges, Ending, GameState } from '../../domain/adventure/types.ts';
import { isAdventureSession } from '../../domain/adventure/session.ts';

// ui 레이어는 domain 값을 직접 import할 수 없다(타입 전용 규칙). 한국어 표시 이름의 정본은
// domain/adventure/display-names.ts 하나이고, ui는 이 재수출을 통해 같은 표를 쓴다.
export { ADVENTURE_DISPLAY_NAMES } from '../../domain/adventure/display-names.ts';

/** 한 번의 주사위 판정 기록. 화면에 "d20=14 ≥ 12 성공"처럼 한 줄로 보여 준다. */
export interface DiceRoll {
  sides: number;
  difficulty: number;
  roll: number;
  success: boolean;
}

/** 끝난 턴의 화면 기록. 서버 세션과 별개로 UI가 보여 주기 위한 사본이다. */
export interface AdventureLogEntry {
  action: string;
  narrative: string;
  dice: DiceRoll[];
  applied?: AppliedChanges;
  invalid?: boolean;
}

/** 진행 중인 턴. result 를 받으면 로그로 확정된다. */
export interface StreamingTurn {
  action: string;
  text: string;
  dice: DiceRoll[];
}

export type AdventurePhase = 'idle' | 'starting' | 'turn' | 'ended';

export interface AdventureView {
  /** 서버가 만든 세션. 화면 표시용 preview 와 달리 결과(result)에서만 교체한다. */
  session: AdventureSession | null;
  /** state 이벤트의 표시 전용 상태. 세션을 낙관적으로 갱신하지 않기 위한 값이다. */
  preview?: GameState;
  /** ending 이벤트로 확정된 엔딩. 결과 세션이 오기 전에도 화면에 알린다. */
  ending?: Ending;
  log: AdventureLogEntry[];
  streaming?: StreamingTurn;
  phase: AdventurePhase;
  error: string;
  /** 새로 고침으로 복원한 세션의 지난 이야기를 로그에 채웠는지. */
  restored: boolean;
}

export const MAX_LOG_ENTRIES = 50;
export const INVALID_TURN_MESSAGE = '서술을 받지 못했어요. 다른 행동을 입력해 보세요.';

export function initialState(): AdventureView {
  return { session: null, log: [], phase: 'idle', error: '', restored: false };
}

export function reset(): AdventureView {
  return initialState();
}

/** localStorage 등에서 온 값이 세션으로 성립하는지 확인한다. 손상된 값은 null. */
export function restoreSession(value: unknown): AdventureSession | null {
  return isAdventureSession(value) ? value : null;
}

export function beginStart(view: AdventureView): AdventureView {
  return { ...view, phase: 'starting', error: '', streaming: undefined, preview: undefined, restored: false };
}

export function beginTurn(view: AdventureView): AdventureView {
  return { ...view, phase: 'turn', error: '', streaming: undefined, preview: undefined, restored: false };
}

function pushLog(view: AdventureView, entry: AdventureLogEntry): AdventureLogEntry[] {
  return [...view.log, entry].slice(-MAX_LOG_ENTRIES);
}

function emptyStream(): StreamingTurn {
  return { action: '', text: '', dice: [] };
}

/**
 * 서버 스트림 이벤트를 화면 상태로 접는다. 순수 함수이며 DOM·스토리지에 접근하지 않는다.
 * 이벤트 순서는 accepted → dice* → narrative* → state|invalid → ending? 이다.
 * state 이벤트는 preview(표시 전용)만 바꾸고 session 은 result 의 commit 에서만 교체한다.
 */
export function reduceEvent(view: AdventureView, event: AdventureEvent): AdventureView {
  const stream = view.streaming ?? emptyStream();
  switch (event.kind) {
    case 'accepted':
      return { ...view, streaming: { action: event.action, text: '', dice: [] } };
    case 'dice':
      return {
        ...view,
        streaming: {
          ...stream,
          dice: [...stream.dice, {
            sides: event.sides, difficulty: event.difficulty, roll: event.roll, success: event.success,
          }],
        },
      };
    case 'narrative':
      // 서버가 완성된 서술 1개를 보낸다(문장 조각 스트리밍 없음).
      return { ...view, streaming: { ...stream, text: event.text } };
    case 'state':
      return {
        ...view,
        preview: event.state,
        ending: event.state.ending ?? view.ending,
        log: pushLog(view, { action: stream.action, narrative: stream.text, dice: stream.dice, applied: event.applied }),
        // result 를 받을 때까지는 요청이 진행 중이다. phase 를 idle 로 내리지 않는다.
        streaming: undefined,
        phase: event.state.ending ? 'ended' : 'turn',
      };
    case 'invalid':
      return {
        ...view,
        log: pushLog(view, {
          action: stream.action, narrative: stream.text, dice: stream.dice, invalid: true,
        }),
        streaming: undefined,
        phase: view.session?.state.ending ? 'ended' : 'turn',
      };
    case 'ending':
      return {
        ...view,
        ending: event.ending,
        preview: view.preview ? { ...view.preview, ending: event.ending } : view.preview,
        phase: 'ended',
      };
  }
}

/** 새로 고침 복원 시 로그를 채울 지난 이야기. 서술은 이미 400자로 잘린 값이다. */
export function restoredLog(session: AdventureSession): AdventureLogEntry[] {
  return session.recent.map((turn) => ({ action: turn.action, narrative: turn.narrative, dice: [] }));
}

/** result 프레임의 세션을 화면 상태의 정본으로 삼는다(서버가 만든 새 세션). */
export function commit(view: AdventureView, session: AdventureSession): AdventureView {
  // state/invalid 이벤트 없이 끝난 스트림(start 의 첫 장면 등)은 여기서 로그로 확정한다.
  const stream = view.streaming;
  const log = stream && (stream.text || stream.dice.length)
    ? pushLog(view, { action: stream.action, narrative: stream.text, dice: stream.dice })
    : view.log;
  return {
    ...view,
    session,
    preview: undefined,
    // 스트림 중 임시로 세운 ending 은 이어받지 않는다. 엔딩은 결과 세션만 정본이다.
    ending: session.state.ending,
    log,
    streaming: undefined,
    error: '',
    restored: false,
    phase: session.state.ending ? 'ended' : 'idle',
  };
}

/** result 없이 실패하면 임시 ending·preview·진행 phase 를 정본 세션 기준으로 되돌린다. */
export function fail(view: AdventureView, reason: string): AdventureView {
  const ending = view.session?.state.ending;
  return {
    ...view,
    error: reason,
    streaming: undefined,
    preview: undefined,
    ending,
    phase: ending ? 'ended' : 'idle',
  };
}
