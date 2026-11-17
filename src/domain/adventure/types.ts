import type { Result } from '../chat.ts';

export const SHIP_DAY = 5;
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'fog' | 'storm';
export type LocationId = 'quarters' | 'stairwell' | 'lantern-room' | 'shore' | 'boathouse' | 'cliff-path';
export type RepairPart = 'lens' | 'clockwork' | 'oil';
export type Ending = 'cleared' | 'dead' | 'missed';

export interface Stats { health: number; warmth: number; focus: number }   // 0..100 정수
export interface GameState {
  day: number;                      // 1..
  time: TimeOfDay;
  timeActions?: number;              // 유효 행동 누적 0..2, 과거 세션은 0으로 처리
  weather: Weather;
  location: LocationId;
  stats: Stats;
  inventory: string[];              // ≤ 12개, 각 1..24자, 소문자·숫자·하이픈
  repairs: Record<RepairPart, boolean>;
  ending?: Ending;
}

/** 모델이 돌려주는 한 턴의 결과. 상태 전체가 아니라 변화량이다. */
export interface TurnOutcome {
  narrative: string;                                   // 1..1200자
  statChanges: Partial<Stats>;                         // 각 −40..+40 정수. 기본 소모는 포함하지 않음
  addItems: string[]; removeItems: string[];           // 각 ≤ 4개
  location?: LocationId; time?: TimeOfDay; weather?: Weather;
  repaired?: RepairPart[];                             // 코드가 부품 아이템·장소·집중 조건으로 재검증
  sleep?: boolean;                                     // quarters에서만 유효
  lampLit?: boolean;                                   // 클리어 요청. 코드가 재검증
}

/** applyTurn이 실제로 적용한 것. 일지와 화면 표시에 쓴다. */
export interface AppliedChanges {
  stats: Stats;                      // 최종 delta(기본 소모 + 패널티 + 모델 변화량, 클램프 반영)
  added: string[]; removed: string[];
  repaired: RepairPart[]; rejected: string[];   // 거부 사유 코드: 'repair:no-part' | 'repair:not-lantern-room' | 'repair:no-focus' | 'sleep:not-quarters' | 'lamp:not-ready' | 'lamp:too-late'
  slept: boolean; moved?: LocationId;
}

export interface TurnRecord { action: string; narrative: string }  // narrative는 400자로 잘라 보관
export interface AdventureSession {
  version: 1;
  state: GameState;
  journal: string[];                 // 코드가 만든 요약, ≤ 12줄 × 80자
  recent: TurnRecord[];              // 최근 ≤ 4턴
  turn: number;                      // 누적 턴 수
}

export type AdventureEvent =
  | { kind: 'accepted'; action: string }
  | { kind: 'dice'; sides: number; difficulty: number; roll: number; success: boolean }
  | { kind: 'narrative'; index: number; text: string; final: boolean }   // 문장 단위 조각
  | { kind: 'state'; state: GameState; applied: AppliedChanges }
  | { kind: 'invalid'; reason: string }                                  // 무효 턴: 상태 불변
  | { kind: 'ending'; ending: Ending; day: number };
export type AdventureListener = (event: AdventureEvent) => void;

export interface AdventureClient {        // ui가 쓰는 포트(infra가 구현)
  start(onEvent?: AdventureListener, signal?: AbortSignal): Promise<Result<AdventureSession>>;
  turn(session: AdventureSession, action: string, onEvent?: AdventureListener, signal?: AbortSignal): Promise<Result<AdventureSession>>;
}
export interface GameMaster extends AdventureClient {}   // app 구현도 같은 시그니처(서버·클라이언트 대칭)
