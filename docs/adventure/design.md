# /adventure 구현 설계

작성: ps-fable, 2026-11-17. 근거: `analysis.md`(책 5.1절 원칙), 5.2.0 축소 명세, ps-sol·ps-ds 결과, ai-ps 현재 코드. 책의 예제 게임은 재현하지 않는다. 세계관·주인공·스탯·종료 조건은 모두 새로 만들었다.

## 0. 결정 요약

| 항목 | 결정 |
|---|---|
| 게임 | **「잿빛 등대」**. 폭풍으로 고립된 등대지기 견습생이 닷새 안에 꺼진 등대를 다시 켜 암초 해역을 지날 배를 구한다. 생존이 아니라 **기한 안의 복구**가 목표 |
| 모델 호출 | 기존 `createOpenAICompletion`의 function 게이트웨이 재사용. 1턴 = JSON 응답(서술+변화량) 1회 + 주사위 도구 왕복 최대 3회(응답당 2개). `response_format: json_object`. `ADVENTURE_TEMPERATURE`를 명시한 경우에만 `temperature` 전송. 요약 호출은 도구 없이 `max_completion_tokens: 400`·`reasoning_effort: 'none'` |
| 서버 | **무상태**. 세션(상태·최근 4~8턴·요약)은 클라이언트가 보관해 매 요청에 보내고, 서버는 검증 후 새 세션을 돌려준다. Workers에 저장소를 두지 않는다 |
| 스트리밍 | NDJSON 이벤트. `narrative`는 한 번만 보낸다. 토큰 스트리밍 없음 |
| 히스토리 | 최근 4~8턴 원문(각 400자) + 오래된 턴의 요약(≤600자) + 현재 상태 JSON |
| 실패 | 파싱 실패 턴은 무효(상태·이력 불변, `turn`만 증가). 변화량 범위 초과는 클램프. 모델 오류는 problem 프레임 |
| UI | SolidJS 페이지 `/adventure`. 클라이언트 상태 zustand(vanilla+persist, `session`만) + Solid 브리지, 턴 요청은 TanStack Query mutation. 진행 중에는 입력·새 게임 비활성 |
| 에셋 | 스크립트 1회 생성 → `public/adventure/` 커밋. 런타임 생성 없음 |

## 1. 게임 규칙 (domain 정본)

### 세계관
- 장소 6곳: `quarters`(숙소), `stairwell`(나선 계단), `lantern-room`(등실), `shore`(자갈 해안), `boathouse`(보트 창고), `cliff-path`(절벽 길). 시간대 4단계: `dawn`·`day`·`dusk`·`night`. 날씨 3종: `clear`·`fog`·`storm`.
- 주인공: 견습 등대지기 **"노을"**(성별 미정, 20대, 회색 니트 모자·노란 방수 외투·주근깨). 등대지기 스승은 폭풍 전날 뭍으로 나가 돌아오지 못했다.
- 목표: **5일차 밤**에 보급선이 암초 해역을 지난다. 그 전에 등대를 다시 켜야 한다.

| 수리 부품 | 아이템 ID | 획득 출처 |
|---|---|---|
| 렌즈 | `spare-lens` | `cliff-path` 절벽 길의 수리 상자 |
| 태엽 | `clock-spring` | `boathouse` 보트 창고의 공구함 |
| 등유 | `lamp-oil` | `boathouse` 보트 창고의 반쯤 남은 등유통 |

### 스탯 3종(0~100)
| 스탯 | 의미 | 기본 변화(코드) | 0일 때(코드) |
|---|---|---|---|
| `health` 체력 | 부상·추위·탈진으로 감소 | 행동당 0 | 0 → 사망 엔딩 |
| `warmth` 온기 | 매 행동 −6, `storm`+`night`면 −12. 난로·차로 회복 | 행동당 −6/−12 | 0이면 행동당 체력 −10 |
| `focus` 집중 | 매 행동 −4. 수리·정밀 작업에 추가 소모. 잠·휴식·차로 회복 | 행동당 −4 | 0이면 수리 불가(코드가 `repaired` 거부) + 행동당 체력 −5 |

### 진행
- 잠(`sleep: true`) → 기본 소모를 적용한 뒤 체력 +15, 집중 +40(상한 100). `day`·`time`을 생략하면 다음 날 새벽을 쓴다.
- 날짜와 시간은 모델이 `day`(1~6)와 time enum으로 보고하고, 코드는 값 범위만 검증한다.
- 난로 회복은 숙소에서 이미 가진 `driftwood`와 `matches`로 불을 살린 경우 모델이 온기 +20 및 `driftwood` 소모를 보고한다. 기본 소모는 코드가 별도로 적용한다. 땔감이 없으면 실패로 서술하며 회복하지 않는다.
- 수리 3부품: `lens`(예비 렌즈), `clockwork`(회전 태엽), `oil`(등유). 각각 **정식 아이템 ID** `spare-lens`·`clock-spring`·`lamp-oil`을 인벤토리에 가진 상태에서 `lantern-room`에 있을 때만 수리가 성립한다(코드가 검사·소모).
- 클리어: 3부품 수리 완료 + `lantern-room` + 모델이 `lampLit: true` 보고 + `day ≤ 5`. 코드가 재검증.
- 실패 엔딩 2종: `dead`(체력 0), `missed`(6일차 `dawn`에 도달했는데 등대가 꺼져 있음).
- 확률 상황(절벽 오르기, 폭풍 속 이동, 창고 뒤지기, 바다에 떠내려온 물건 건지기)은 `roll_dice` 도구 필수.

### 첫 장면
상태를 바꾸지 않는 배경 묘사(책과 같은 원칙). 시작 상태: 1일차 `dawn`, `storm`, `quarters`, 체력 90·온기 55·집중 70, 인벤토리 `['lantern-handheld', 'matches']`, 수리 모두 `false`.

## 2. 레이어 배치

AGENTS.md 규칙(ui→app→domain, infra는 조립 루트에서 app에 주입, ui의 domain import는 타입 전용)을 그대로 따른다.

```
src/domain/adventure/
  types.ts        GameState · Stats · TurnOutcome · AdventureEvent · AdventureSession · 상수(START_STATE, SHIP_DAY=5, LIMITS)
  rules.ts        applyTurn(state, outcome) → { state, applied }  순수·결정적
  outcome.ts      parseTurnOutcome(content) → Result<TurnOutcome>  (형식·범위 검증, {…} 구간 재파싱)
  dice.ts         rollDice(sides, difficulty, random) · DICE_TOOL 정의(strict 스키마)
  history.ts      buildTurnMessages(session, action) · splitForSummary/buildSummaryMessages/applySummary · 최근 4~8턴·요약 관리
  session.ts      isAdventureSession(value) 타입 가드 · createSession()
src/app/adventure/
  game-master.ts  createGameMaster(model: FunctionCompletionGateway, { random?, log?, temperature? })
                  → { start(signal?, onEvent?) ; turn(session, action, onEvent?, signal?) }
  session-store.ts  reduceEvent(view, event) · 클라이언트 표시 상태의 순수 리듀서(외부 import 없음)
src/infra/
  openai.ts            변경 없음(이미 FunctionCompletionGateway)
  http-adventure.ts    createHttpAdventure(fetcher?): AdventureClient  (readJsonLines 재사용)
  adventure-logger.ts  createAdventureLogger(pino|console) → AdventureLogListener (tool-logger 패턴)
src/ui/http/api.ts     POST /api/adventure/start · POST /api/adventure/turn (progress() 재사용)
src/ui/state/
  solid-store.ts       useStore(store, selector) — zustand/vanilla 구독 → Solid signal
  adventure-store.ts   createStore(...) zustand vanilla + persist(localStorage)
src/ui/pages/AdventurePage.tsx
src/ui/widgets/adventure/   AdventureWidget · StatusBar · NarrativeLog · ActionBar · EndingPanel
src/ui/components/adventure/  status-view.ts(순수) · narrative-view.ts(순수) · PixelBar.tsx · Portrait.tsx
public/adventure/*.png       8bit 에셋
```

조립: `src/worker.ts`·`vite.config.ts`에 `adventure: createGameMaster(model, { log })` 추가. `src/main.tsx`에 `createHttpAdventure()`를 ui 스토어에 주입. `src/agent.ts`(CLI)는 건드리지 않는다.

## 3. 인터페이스

### 3.1 domain 타입 (`src/domain/adventure/types.ts`)
```ts
export const SHIP_DAY = 5;
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'fog' | 'storm';
export type LocationId = 'quarters' | 'stairwell' | 'lantern-room' | 'shore' | 'boathouse' | 'cliff-path';
export type RepairPart = 'lens' | 'clockwork' | 'oil';
export type Ending = 'cleared' | 'dead' | 'missed';

export interface Stats { health: number; warmth: number; focus: number }   // 0..100 정수
export interface GameState {
  day: number;                      // 1..6
  time: TimeOfDay;
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
  day?: number;                                        // 1..6
  location?: LocationId; time?: TimeOfDay; weather?: Weather;
  repaired?: RepairPart[];                             // 코드가 부품 아이템·장소·집중 조건으로 재검증
  sleep?: boolean;
  lampLit?: boolean;                                   // 클리어 요청. 코드가 재검증
}

/** applyTurn이 실제로 적용한 것. 화면 표시에 쓴다. */
export interface AppliedChanges {
  stats: Stats;                      // 최종 delta(기본 소모 + 패널티 + 모델 변화량, 클램프 반영)
  added: string[]; removed: string[];
  repaired: RepairPart[];
  slept: boolean; moved?: LocationId;
}

export interface TurnRecord { action: string; narrative: string }  // 400자로 잘라 보관
export interface AdventureSession {
  version: 1;
  state: GameState;
  summary?: string;                 // 오래된 턴의 모델 요약, 1..600자
  recent: TurnRecord[];             // 최근 ≤ 8턴
  turn: number;                     // 누적 턴 수
}

export type AdventureEvent =
  | { kind: 'accepted'; action: string }
  | { kind: 'dice'; sides: number; difficulty: number; roll: number; success: boolean }
  | { kind: 'narrative'; text: string }
  | { kind: 'state'; state: GameState; applied: AppliedChanges }
  | { kind: 'invalid'; reason: string }                                  // 무효 턴: 상태 불변
  | { kind: 'ending'; ending: Ending; day: number };
export type AdventureListener = (event: AdventureEvent) => void;

export interface AdventureClient {        // ui가 쓰는 포트(infra가 구현)
  start(onEvent?: AdventureListener, signal?: AbortSignal): Promise<Result<AdventureSession>>;
  turn(session: AdventureSession, action: string, onEvent?: AdventureListener, signal?: AbortSignal): Promise<Result<AdventureSession>>;
}
export interface GameMaster extends AdventureClient {}   // app 구현도 같은 시그니처(서버·클라이언트 대칭)
```

### 3.2 HTTP 계약 (`/api/adventure/*`, 모두 POST, NDJSON 항상)
| 경로 | 요청 본문 | 제한 | 프레임 |
|---|---|---|---|
| `/api/adventure/start` | `{}` | bodyLimit 1_000 | `event`(narrative, state) → `result { value: AdventureSession }` |
| `/api/adventure/turn` | `{ session: AdventureSession, action: string }` | bodyLimit 32_000, action 1..200자(trim), session은 `isAdventureSession`으로 검증 | `event`(accepted, dice*, narrative, state 또는 invalid, ending?) → `result { value: AdventureSession }` |
| 실패 | | | 첫 프레임 전: Problem Details 400/413/405/502. 이후: `{ type: 'problem', problem }` |

- 이미 끝난 세션(`state.ending` 있음)으로 `turn`을 부르면 400 "게임이 끝났습니다. 새 게임을 시작하세요."
- `result`의 세션은 서버가 새로 만든 것이며 클라이언트는 이것으로 교체한다(낙관적 갱신 없음).
- `createApi`의 `ApiDependencies`에 `adventure: GameMaster` 추가.

### 3.3 주사위 도구
```ts
DICE_TOOL = { name: 'roll_dice',
  description: '성공/실패가 확률에 달린 행동에서 반드시 호출한다. sides면 주사위 1개를 굴려 결과가 difficulty 이상이면 성공이다.',
  parameters: { type: 'object', properties: { sides: { type: 'integer', minimum: 2, maximum: 100 }, difficulty: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['sides', 'difficulty'], additionalProperties: false } }
```
`rollDice(sides, difficulty, random)` → `{ roll, success, sides, difficulty }`. 인자 검증 실패는 `{ ok: false, reason }`(모델에게 그대로 전달). 기존 `strict: true` 래핑과 호환되는 스키마다.

## 4. 턴 처리 흐름 (`game-master.ts`)

1. `accepted` 이벤트(trim한 행동).
2. 메시지 구성(`buildTurnMessages`): `system`(규칙 전문) → `summary`가 있으면 `user: [이전 진행 요약]\n…` → 최근 4~8턴을 `user: 행동` / `assistant: 서술 텍스트만` 쌍으로 → 마지막 `user`: `[현재 상태 JSON]\n…\n행동: …`.
3. `model.complete(messages, [DICE_TOOL], { response_format: { type: 'json_object' }, temperature, signal })`.
4. `tool_calls`가 있으면 각 호출을 `rollDice`로 처리해 `dice` 이벤트를 내고 `role: 'tool'` 메시지로 추가한 뒤 재호출. 응답당 2개, 왕복 최대 3회(상수). 초과 시 마지막 응답을 그대로 파싱 시도.
5. `parseTurnOutcome(content)`. 실패 → `invalid` 이벤트, `turn+1`만 하고 상태·이력 불변, 로그 `warn`. (책의 "무효 턴" 원칙)
6. `applyTurn(state, outcome)` → 새 상태와 `applied`. `state` 이벤트. 엔딩이 생기면 `ending` 이벤트.
7. `narrative` 이벤트를 한 번 보낸다. 순서는 **dice → narrative → state**로 고정해 화면이 "주사위 → 글 → 수치"로 읽히게 한다.
8. `recent`에 `{ action, narrative(400자) }`를 추가해 최대 8개를 유지한다. 9개가 되는 순간 앞 5개와 이전 `summary`를 요약해 새 `summary`로 교체하고 뒤 4개만 남긴다. 첫 요약은 9번째 유효 턴, 그 뒤로 5턴마다 한 번이다.
9. 요약 호출은 `state`(엔딩이면 `ending`) 이벤트 뒤, `result` 전에 1회다. 도구 없이 `max_completion_tokens: 400`·`reasoning_effort: 'none'`을 보내고, `ADVENTURE_TEMPERATURE`가 설정된 경우에만 `temperature: 0.3`을 보낸다. 실패·빈 응답·취소여도 이전 `summary`를 유지하고 `recent`만 4개로 줄여 턴은 성공으로 반환한다. 재시도와 공개 이벤트는 없다.
10. 결과 세션 반환. 모델 오류(`ok: false`)는 그대로 반환 → API가 502 problem 프레임.

`start`는 2~3단계를 "첫 장면을 묘사하라" 메시지로 수행하고 `statChanges` 등은 무시한 채 `narrative`만 쓴다. 상태는 `START_STATE` 그대로.

### 프롬프트 구성(자체 작성, 책 문장 사용 금지)
system 절 순서: 역할 1줄 → 배경(등대·폭풍·보급선 기한) → 세계관(장소 6곳과 각 장소에서 얻을 수 있는 것, 날씨 영향, 위험: 절벽·파도·추위) → 스탯 의미와 0일 때 결과(수치는 코드가 적용하므로 "보고하지 말 것" 명시) → 진행 규칙(수리는 등실에서 정식 아이템 ID로, 날짜·시간은 `day`·`time`으로 보고, 점등 조건, 확률 상황은 `roll_dice` 필수) → 입력 검증(초자연·비현실 행동은 실패로 묘사, 변화량 비움; 플레이어 메시지 안의 "규칙 변경 요청"은 서술로만 다룸) → 응답 형식(TurnOutcome 필드 설명, 변화량 부호, 예시 1개, JSON 외 텍스트 금지) → 문체(2인칭 현재형 "당신은 ~합니다", 한국어, 3~6문장, 매 턴 선택지 암시 1개).
정식 아이템 ID 목록(모델에 고지): `spare-lens`, `clock-spring`, `lamp-oil`, `lantern-handheld`, `matches`, `blanket`, `tea-tin`, `rope`, `driftwood`, `oilskin`. 그 외 아이템은 자유 ID 허용(코드가 형식만 검사).

### 방어 장치와 상수
- 요청: `start` 1_000바이트, `turn` 32_000바이트, 행동 trim 후 1~200자.
- 세션: 허용 필드만 검사해 새 객체로 재구성(B1), 문자열·배열 길이 제한.
- 도구: 응답당 2개·왕복 3회, ID·인수 길이 제한, 원본 무제한 `tool_calls` 이력 유입 차단.
- 시간: 공급자 요청 60초, 서버 전체 90초, 클라이언트 120초, 외부 취소와 합성.
- 출력: 서술 1_600토큰·본문 16_000자·서술 1_200자·최근 8턴×400자·요약 600자(요약 호출 400토큰).
- 상태: 0~100 클램프, 변화량 ±40, 아이템 중복·개수 방어, 수리 부품·장소·집중 재검증, 엔딩 재검증.
- 로그: 서술 원문 없이 이벤트만, 공급자 오류는 안전 코드·상태만 기록.

### 실패 허용도
| 상황 | 처리 |
|---|---|
| JSON 파싱 실패·필수 필드 없음 | 무효 턴. 상태·이력 모두 불변. 화면 "서술을 받지 못했어요. 다른 행동을 입력해 보세요." 원문 미표시 |
| 변화량 범위 초과·비정수 | 해당 값만 클램프/0 처리. 화면에는 적용된 값만 표시 |
| `repaired`·`sleep`·`lampLit` 조건 불충족 | 해당 항목만 거부, 서술은 그대로 표시(모델 서술과 수치가 어긋나는 것을 감수) |
| 도구 3라운드 초과 | 마지막 응답 파싱. `tool_calls`만 있고 내용 없으면 무효 턴 |
| 모델 오류·타임아웃(공급자 60초, 서버 전체 90초) | problem 502. 클라이언트 세션 유지, 재시도 버튼 |
| 클라이언트 타임아웃 | 120초. 초과 시 세션 유지 |

세계관 밖 입력은 프롬프트로만 막는다. 가끔 모델이 들어주더라도 수치는 클램프·재검증이 지키므로 치명적이지 않다(책 5.1.1). 요약 호출이 실패해도 본 턴은 성공한다.

## 5. UI 설계 (ps-ds)

### 상태 관리
- **zustand**: `src/ui/state/adventure-store.ts`에서 `createStore`(`zustand/vanilla`) + `persist`(`localStorage`, 키 `ai-ps.adventure.v1`, `session`만 저장). 상태: `session?`, `log: LogEntry[]`(행동·서술·주사위·적용 변화), `streaming: { text: string; dice: DiceEvent[] }`, `phase: 'idle'|'starting'|'turn'|'ended'`, `error`. 액션: `applyEvent(event)`(→ `app/adventure/session-store.ts`의 `reduceEvent` 순수 함수 호출), `commit(session)`, `fail(reason)`, `reset()`.
- **Solid 브리지**: `src/ui/state/solid-store.ts`의 `useStore(store, selector, equals?)`는 `createSignal(selector(store.getState()))` + `store.subscribe`로 갱신, `onCleanup`으로 해제.
- **TanStack Query**: `@tanstack/solid-query`. `createMutation`의 `startGame`·`playTurn`이 스트림 이벤트를 zustand로 흘리고, Query는 pending·error·취소 생명주기만 맡는다. `retry: 0`, `networkMode: 'always'`, "중단" 버튼이 `AbortController`를 취소한다. 세션은 `result`에서만 `commit`한다(낙관적 갱신 없음). 진행 중에는 `busy()`(phase + mutation pending)로 입력·새 게임을 막아 늦은 결과가 새 상태를 덮지 못하게 한다.
- 의존성 추가: `zustand`, `@tanstack/solid-query`. 설치 후 `pnpm typecheck`.

### 화면 (`/adventure`)
- 초상은 상태로 3장 중 선택(`status-view.ts` 순수 함수: 체력 ≤ 30 → hurt, 온기 ≤ 25 또는 집중 ≤ 20 → cold, 그 외 ok).
- 스탯 바는 `role="meter"`와 숫자 라벨을 가진 CSS 8칸 픽셀 바(이미지 없음). 수리 아이콘 3개는 완료 여부로 밝기 전환. 헤더 엠블럼은 등대 꺼짐/켜짐 2장.
- 날짜·시간·날씨·장소와 한국어 표시 이름(공용 display-names), lucide Select를 쓴다. 서술 로그에는 주사위 결과를 "🎲 d20=14 ≥ 12 성공" 한 줄로 표시한다.
- 엔딩 패널: `cleared`(등대 켜짐 그림 + 일수), `dead`(초상 hurt + 문구), `missed`(등대 꺼짐 + 문구). "새 게임" 버튼.
- 접근성: 서술 영역 `role="log" aria-live="polite"`, 주사위 결과 `role="status"`, 입력 비활성 시 안내. 이미지에만 `image-rendering: pixelated`.
- 테스트 가능한 순수 함수: `status-view.ts`, `narrative-view.ts`(주사위 한 줄 문구), `app/adventure/session-store.ts`의 `reduceEvent`.

## 6. 에셋 계획

### 목록(8장, 상한 10장)
| 파일 | 용도 | 원본 생성 크기 → 최종 | 비고 |
|---|---|---|---|
| `portrait-ok.png` | 평상시 초상 | 1024² → 64×64 | 기준 이미지 |
| `portrait-hurt.png` | 체력 낮음 | 〃 | 기준 이미지 변형 |
| `portrait-cold.png` | 온기·집중 낮음 | 〃 | 기준 이미지 변형 |
| `icon-lens.png` | 수리 부품 | 1024² → 32×32 | |
| `icon-clockwork.png` | 수리 부품 | 〃 | |
| `icon-oil.png` | 수리 부품 | 〃 | |
| `lighthouse-dark.png` | 헤더·missed 엔딩 | 1024² → 96×96 | |
| `lighthouse-lit.png` | 헤더(클리어)·cleared 엔딩·파비콘 원본 | 〃 | |
날씨·주사위·인벤토리 아이템은 텍스트·CSS로 처리해 장수를 줄인다.

### 8bit 스타일 가이드
- **해상도**: 모델 출력(고해상도 "픽셀 느낌")을 그대로 쓰지 않는다. 최종 픽셀 격자(64/32/96)로 **최근접 보간 축소** 후 CSS `image-rendering: pixelated`로 확대한다. 시스템에 `magick`이 없어 Python Pillow의 `Image.Resampling.NEAREST`로 대체한다(`sips`는 보간이 섞이므로 쓰지 않는다).
- **팔레트**: 16색 고정(`public/adventure/palette.png`를 먼저 만들어 커밋). 계열: 밤바다 남색 3단, 안개 회색 3단, 등불 호박색 3단, 피부·모래 3단, 방수 외투 노랑 2단, 검정, 흰색. 모든 산출물을 `Image.quantize(palette=palette.png, dither=NONE)`으로 양자화해 톤을 통일한다.
- **배경**: 단색 마젠타(#FF00FF)로 생성 후 허용 오차 48로 투명 키잉. 가장자리 헤일로가 남으면 오차를 낮추고 재생성.
- **프롬프트 공통 접두어**(영문, 매니페스트에 1곳만 둔다): "8-bit pixel art sprite, strict 16-color palette, hard pixel edges, no anti-aliasing, no gradients, no text, no watermark, centered subject filling 80% of the frame, plain solid #FF00FF background." 주인공 고정 묘사: "young lighthouse keeper apprentice, short dark hair under a grey knit cap, yellow oilskin coat, freckles, calm expression"(변형 2장은 표정·안색 구절만 교체).
- **일관성 전략**: 이미지 API에 시드가 없을 수 있으므로 ① 접두어·주인공 묘사 문자열 고정 ② 첫 초상을 기준 이미지로 삼아 변형 2장은 **편집(이미지 참조) 엔드포인트**가 있으면 그것으로, 없으면 같은 접두어로 재생성 ③ 팔레트 리맵으로 색을 강제 ④ 3장을 나란히 놓고 눈으로 비교해 어긋나면 그 1장만 재생성.

### 모델 배정 절차(`gpt-image-2.6-sunburst` vs `flare`)
1. `portrait-ok`를 두 모델로 각각 생성(`--model` 인자), `/tmp/adventure-assets/compare/`에 저장.
2. 비교 기준: 픽셀 가장자리 선명도(축소 후 뭉개짐), 팔레트 준수, 마젠타 배경 키잉 결과, 프롬프트 충실도(모자·외투), 비용·속도.
3. 하나를 고르고 매니페스트 `model` 기본값으로 기록. 나머지 7장은 그 모델로만 생성한다. 비교 결과와 선택 이유를 `public/adventure/CREDITS.md`에 적는다.
4. 선택 모델이 참조 편집을 지원하면 초상 변형 2장에만 쓴다.

### 모델 선택 결과와 후처리 (2026-11-17)
- `gpt-image-2.6-flare`로 통일했다. 64px로 줄였을 때 얼굴 비중이 커 가독성이 좋았고, 생성 시간도 `sunburst`의 54.3초에 비해 23.8초로 약 2배 빨랐다.
- `portrait-ok`는 비교본 `/tmp/adventure-assets/compare/flare.png`를 재사용했고, 변형 중 `portrait-hurt`만 같은 원본을 참조 이미지로 `/v1/images/edits`를 한 번 호출해 만들었다. `portrait-cold`는 API 호출 없이 `portrait-ok`의 팔레트 스왑으로 만들었다.
- 후처리는 Python Pillow 13(`scripts/adventure-postprocess.py`, `python3 -I` 실행)으로 마젠타 키잉 → 16색 리맵 → NEAREST 축소를 한 번에 처리한다. `sips` 축소본은 쓰지 않는다.
- **변형 초상은 팔레트 스왑이 1순위다.** 기준 초상(`portrait-ok`)의 피부·볼 색만 16색 팔레트 안의 차가운 청회색으로 치환해 만든다(`--palette-swap`). 알파 채널이 원본과 픽셀 단위로 같아 모자·외투·머리카락·윤곽선이 그대로 유지된다. API 참조 편집(`/v1/images/edits`)은 배경을 마젠타로 유지하지 못해 불안정하므로 후순위로 둔다.

### 스크립트
- `scripts/generate-adventure-assets.mjs` + `scripts/adventure-assets.json`(이름·용도·프롬프트·크기·모델).
- 실행: `node --env-file=.env scripts/generate-adventure-assets.mjs [--only <name>] [--model <id>] [--out <dir>] [--dry-run]`. 키는 `OPENAI_API_KEY`만, 주소는 `OPENAI_IMAGE_BASE_URL`(기본 `https://api.openai.com/v1`). 값 출력 금지.
- 단계: 생성(원본 `/tmp/adventure-assets/raw/`) → 키잉·리맵·최근접 축소(`public/adventure/`) → `CREDITS.md` 갱신. 원본은 커밋하지 않는다.
- 1회 실행 후 `public/adventure/*.png`·`palette.png`·`CREDITS.md`를 커밋한다. 런타임·CI에서 이미지 API를 부르지 않는다.

## 7. 워커 분담 (파일 겹침 없음)

### 선행(총괄 ps-opus)
- 3절 인터페이스를 `src/domain/adventure/types.ts`로 커밋하고, 실패하는 테스트 골격을 먼저 둔다. 이후 워커에 동시에 지시.

### ps-sol — 백엔드
- 담당: `src/domain/adventure/{rules,outcome,dice,history,session}.ts`, `src/app/adventure/game-master.ts`, `src/infra/{http-adventure,adventure-logger}.ts`, `src/ui/http/api.ts`, `src/worker.ts`, `vite.config.ts`, 백엔드 테스트.
- 금지: `src/ui/**`(api.ts 제외), `src/main.tsx`, `package.json`, `docs/`, `public/`, `scripts/`.
- 테스트 핵심: 기본 소모·폭풍 밤 가중·0 패널티·클램프, 수리 조건 재검증, 잠 회복과 모델 보고 날짜·시간, 클리어·사망·기한 엔딩, 파싱 실패 무효 턴(세션 `turn`만 증가), 도구 응답당 2개·왕복 3회, 단일 `narrative`, API 프레임 순서(dice→narrative→state), 종료 세션 400.

### ps-ds — UI
- 담당: `package.json`·`pnpm-lock.yaml`, `src/app/adventure/session-store.ts`, `src/ui/state/*`, `src/ui/pages/AdventurePage.tsx`, `src/ui/widgets/adventure/**`, `src/ui/components/adventure/**`, `src/ui/App.tsx`, `src/ui/pages/IndexPage.tsx`, `src/main.tsx`, UI 테스트.
- 금지: `src/domain/**`, `src/infra/**`, `src/ui/http/**`, `docs/`, `public/`, `scripts/`.
- 결정 사항 기록: zustand vanilla + 브리지, mutation·onEvent 역할 분담, `busy()` 입력 잠금을 코드 주석에 남긴다.

### ps-hf — 문서·에셋
- 담당: `docs/adventure/analysis.md`·`design.md`, `scripts/generate-adventure-assets.mjs`, `scripts/adventure-assets.json`, `scripts/adventure-postprocess.py`, `public/adventure/**`.
- 금지: `src/**`, `package.json`.

### 통합 순서
1. 총괄: 타입·실패 테스트 커밋 → 워커 지시 전송.
2. ps-sol·ps-ds 병행. typecheck 일시 실패는 허용.
3. ps-hf 에셋 비교 결과 → 총괄 선택 → 나머지 생성.
4. 교차 리뷰: ps-astra(백엔드), ps-fable(프롬프트·규칙·UI 흐름). 공개 라우트 추가이므로 배포 전 리뷰 게이트 적용.
5. 총괄: 스크린샷 확인 → `pnpm release` → `pnpm run deploy` → Discord.

## 8. 위험·미결

| # | 위험 | 대응·결정 필요 |
|---|---|---|
| 1 | **비용**: 턴당 최대 4회 호출(도구 왕복 3회) + 요약 호출(9번째 유효 턴부터 5턴마다 1회). 공개 URL 무인증 | 왕복 3회·응답당 2개·서버 90초·bodyLimit·action 200자를 상수로 고정. Cloudflare rate limiting은 운영 작업으로 별도 결정 |
| 2 | **temperature 거부**: reasoning 계열 모델은 `temperature`를 거절할 수 있다 | `ADVENTURE_TEMPERATURE`만 선택 설정(미설정·빈 값이면 미전송). 첫 배포 전 1턴 스모크 |
| 3 | **`strict: true` + `reasoning_effort: 'none'` 고정** | 도구 스키마는 strict 호환으로 작성. 공급자 교체 시 호환성 확인 필요 |
| 4 | **JSON 파싱 실패 빈도** | `response_format: json_object` + `{…}` 재파싱 + 무효 턴. 로그로 빈도 측정 후 재요청 추가 여부 결정 |
| 5 | **서술과 상태 불일치** | 조건 미충족 항목은 거부하고 화면에는 적용된 값만 표시 |
| 6 | **세션 위·변조**: 클라이언트가 세션을 들고 있어 스탯 조작 가능 | 단일 플레이어 데모라 허용. 순위표를 만들 때 HMAC 서명 검토 |
| 7 | **프롬프트 인젝션** | 변화량 클램프·조건 재검증으로 수치 피해 차단. 서술 조작은 허용 범위 |
| 8 | **토큰 스트리밍 부재** | dice 프레임 선발신 + `narrative` 1회. 2단계 후보는 서술/상태 2회 호출(2배 비용) |
| 9 | **의존성 호환** | `@tanstack/solid-query`·`zustand`와 Solid 1.9·Vite 8 설치 직후 `pnpm typecheck`·`pnpm build` |
| 10 | **이미지 모델 능력 불확실** | 6절 비교 절차. 부족하면 팔레트 스왑·수동 보정 |
| 11 | **타임아웃** | 공급자 60초 < 서버 90초 < 클라이언트 120초. 초과 시 세션 유지·재시도 |
| 12 | **라우트 추가 = 공개 노출 변경** | 배포 전 리뷰 게이트 적용. 로그에 서술 전문을 남기지 않음 |

## 변경 이력: 5.2.0 축소
- 일지(`journal`) 요약 생성·12줄 관리: 제거. 최근 4턴 원문만 유지.
- 시간대 자동 진행(행동 3회)·역행 거부: 제거. 모델이 `day`·`time`을 보고하고 코드는 범위만 검증.
- 수면 기본 소모 면제·담요 +10·숙소 한정 거부: 제거. 기본 소모와 수면 회복은 유지.
- 거부 코드 세분화·한국어 라벨 매핑: 제거. 적용된 값만 표시.
- 서술 문장 쪼개기 의사 스트리밍(`index`·`final`): 제거. `narrative` 이벤트 1개.
- 요청 세대(`request`) 비교: 제거. 진행 중 입력·새 게임 비활성으로 대체.
- 설정 옵션 노브(`maxToolRounds`·`maxCompletionTokens`·`deadlineMs`·HTTP timeout): 제거. `ADVENTURE_TEMPERATURE`만 선택, 나머지는 상수(3왕복·2개·1600토큰·서버 90초·클라 120초).

## 변경 이력: 5.1.1 반영
- 코드 일지를 복원하지 않고 잘려 나가는 턴을 모델 요약 1개(`summary`, ≤600자)로 대체했다. `recent`는 최대 8개, 9개가 되는 순간 앞 5개와 이전 요약을 요약해 뒤 4개를 남긴다(첫 요약은 9번째 유효 턴, 이후 5턴마다). 도구 메시지는 턴 안에서만 쓰므로 쌍 경계 보정은 불필요하다.
