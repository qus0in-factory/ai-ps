# /talk 구현 설계 — 일본어 회화 연습

작성: ps-fable, 2026-11-17. 근거: `analysis.md`(책 6.1절 원칙), ai-ps 현재 코드(Solid + Hono BFF + Cloudflare Workers, ui/app/domain/infra). 책 범위(STT → LLM → TTS 파이프라인, 교정은 화면에만, 세션 보고서)에 맞춘 최소 설계다. 학습자는 한국어 화자이고 책 예제를 옮기지 않기 위해 연습 언어는 일본어로 정했다. 발화 끝 감지·통합 오디오 모델·실시간 대화는 범위 밖.

## 0. 결정 요약

| 항목 | 결정 |
|---|---|
| 라우트 | `/talk`. API는 `/api/talk/*` 4개(transcribe · turn · speech · report), 모두 POST |
| 응답 형식 | 단일 모델 호출이라 **JSON**(NDJSON 없음). 오디오만 `audio/wav` 바이너리. 오류는 RFC 9457 `application/problem+json` |
| 텍스트 모델 | `OPENAI_MODEL`(gpt-6-luna). 튜터 `reply`는 쉬운 일본어(N5~N4 기본), 교정·설명·보고서는 한국어. 튜터: `response_format: json_object`, reasoning 없음. 보고서: 평문. temperature는 보내지 않는다(gpt-6-luna는 1 이외 값을 거부, `/adventure`와 동일) |
| STT | 브라우저 `MediaRecorder` → BFF 멀티파트 업로드 → `/v1/audio/transcriptions` `gpt-transcribe`, `language=ja`. 녹음 최대 **30초**, 본문 최대 **2 MB**. STT는 캐시하지 않는다 |
| TTS | **(a) Worker가 서버 측 WebSocket으로 Realtime API(`gpt-realtime-2.1-mini`)에 텍스트를 보내 오디오를 받아 WAV로 반환**. 키는 서버에만. (b) ephemeral secret + 브라우저 WebRTC는 채택하지 않음(§4) |
| TTS 캐시 | R2 버킷 `ai-ps-talk-audio`(바인딩 `TALK_AUDIO`)에 `tts/v1/<sha256(모델|음성|프롬프트 버전|정규화 텍스트)>.wav`로 저장·재사용(§5) |
| 세션 | 서버 **무상태**. 턴 기록(학습자 텍스트 + 튜터 JSON)은 클라이언트가 보관해 매 요청에 보내고 서버는 검증 후 사용(`/adventure`와 같은 방식) |
| 상태 관리 | zustand(vanilla + persist, 턴 기록만) + 기존 `useStore` 브리지. 파이프라인 1턴 = TanStack `createMutation` 1개(transcribe → turn → speech 순차), 단계마다 phase 갱신 |
| 교정 표시 | 책 결정 그대로: 교정·제안은 **화면에만**, 음성은 `reply`만 |
| 테스트 | 가짜 fetch·가짜 WebSocket·가짜 CompletionGateway로 전부 오프라인. 실모델은 수동 스모크만 |
| 단계 | 1 텍스트 회화 → 2 녹음·STT → 3 듣기·TTS → 4 마감(선택) |

## 1. 사용자 흐름

1. `/talk` 진입 → "연습 시작" → 튜터가 먼저 일본어로 인사(`turn`에 학습자 텍스트 없이 요청) → 인사 음성 재생.
2. "말하기" 버튼을 누르고 말한 뒤 다시 눌러 멈춤(30초면 자동 정지) → 단계 표시 "듣는 중 → 생각 중 → 말하는 중" → 인식 텍스트, 교정 카드(있을 때), 튜터 대답 표시 → 대답 음성 자동 재생, "다시 듣기" 가능.
3. 1단계에서는 텍스트 입력으로도 말할 수 있다(마이크 없는 환경·테스트용으로 끝까지 유지).
4. "연습 마치기" → 한국어 학습 보고서(반복 실수 · 잘한 표현 · 다음 과제) 표시 → "새 연습".
5. 새로 고침해도 턴 기록은 남는다(localStorage). 보고서·오디오는 저장하지 않는다.

## 2. 도메인 규칙과 한도

| 항목 | 값 |
|---|---|
| 학습자 텍스트 | trim 후 1~500자 |
| 튜터 `reply` | 1~600자(초과 시 자름). `correction`·`betterExpression`은 각 ≤300자 또는 null |
| 턴 수 | 세션당 ≤ 40턴. 넘으면 400 "연습을 마치고 보고서를 받으세요." |
| 녹음 | 최대 30초, 최소 0.5초. MIME `audio/webm`(opus) → `audio/mp4`(Safari) → `audio/ogg` → `audio/wav` 순 지원. 업로드 ≤ 2 MB(bodyLimit 2_500_000) |
| 음성 합성 입력 | 1~600자(reply 그대로) |
| 보고서 | 입력 ≤ 40턴, 출력 ≤ 1,500자(`max_completion_tokens` 800) |
| 타임아웃 | STT 30초, 튜터 60초(공급자 60초와 동일), TTS 30초, 보고서 60초. 클라이언트는 각 단계 +15초 |
| 필수 키 누락 | `reply`가 없거나 빈 문자열이면 코드가 "もう一度言ってもらえますか？"으로 대체하고 교정은 null(책의 방어 1줄과 같은 원칙). 무효 턴 개념은 없다 — 대화는 계속 |

## 3. 레이어 배치(파일)

```
src/domain/talk/
  types.ts        TutorReply · TalkTurn · TalkSession · AudioClip · 포트(Transcriber, Tutor, Speaker, Reporter, Recorder)
  prompt.ts       TUTOR_SYSTEM_PROMPT · buildTutorMessages(session, text?) · buildReportMessages(session)
  expressions.ts  고정 표현 목록(인사·기본 질문) · 정규화 규칙 — TTS 캐시 키 안정화용 상수
  reply.ts        parseTutorReply(content) → TutorReply (json 파싱, 키 검증, reply 기본 문장 대체, 길이 자름)
  session.ts      LIMITS · isTalkSession · normalizeSession · createSession
  audio.ts        pcm16ToWav(pcm: Uint8Array, sampleRate, channels) · isSupportedAudioType(mime)
src/app/talk/
  tutor.ts        createTutor(model: CompletionGateway): Tutor & Reporter  (greet/respond/report)
  session-store.ts  TalkView · reduce 함수(beginTurn/setPhase/addTurn/setAudio/fail/setReport/reset) · restoreSession
src/infra/
  openai-transcribe.ts     createOpenAITranscriber({ apiKey, baseUrl, model, fetcher }): Transcriber
  openai-realtime-speech.ts createRealtimeSpeaker({ apiKey, baseUrl, model, voice, connect }): Speaker
  http-talk.ts             createHttpTalk(fetcher): TalkClient (브라우저 → BFF 4 엔드포인트)
  media-recorder.ts        createBrowserRecorder(): Recorder (MIME 협상, 30초 상한, Blob 반환)
src/ui/http/api.ts         POST /api/talk/{transcribe,turn,speech,report}
src/ui/state/talk-store.ts  zustand vanilla + persist(`ai-ps.talk.v1`, session만)
src/ui/pages/TalkPage.tsx
src/ui/widgets/talk/        TalkWidget · TranscriptLog · SpeakControls · CorrectionCard · ReportPanel · Talk.css
src/ui/components/talk/     transcript-view.ts(순수) · phase-label.ts(순수) · AudioPlayer.tsx
```

- 조립: `src/worker.ts`·`vite.config.ts`에 `talk: { tutor: createTutor(model), transcriber: createOpenAITranscriber(...), speaker: createRealtimeSpeaker(...), audio: env.TALK_AUDIO }` 주입. `src/main.tsx`에 `createHttpTalk()`·`createBrowserRecorder()`·`createTalkStore()` 주입. `src/agent.ts`(CLI)는 건드리지 않는다.
- 환경 변수: `OPENAI_TRANSCRIBE_MODEL`(기본 `gpt-transcribe`), `OPENAI_REALTIME_MODEL`(기본 `gpt-realtime-2.1-mini`), `OPENAI_TTS_VOICE`(기본 `coral`). 키·base URL은 기존 `OPENAI_API_KEY`·`OPENAI_BASE_URL` 재사용(Realtime은 `https`→`wss` 치환). `.env.example`·`worker.ts Env`에 추가하고, `wrangler.jsonc`에 R2 버킷 `ai-ps-talk-audio`를 바인딩 `TALK_AUDIO`로 추가.
- 레이어 규칙: domain은 외부 import 없음(`Blob`·`Uint8Array`는 전역 타입). ui의 domain import는 타입 전용. `Recorder`는 장치 어댑터라 infra에 두고 main.tsx에서 주입한다.

## 4. 인터페이스

### 4.1 domain 타입(`src/domain/talk/types.ts`)
```ts
export interface TutorReply { reply: string; correction: string | null; betterExpression: string | null }
export interface TalkTurn { learner: string; tutor: TutorReply }   // 인사 턴은 learner '' 
export interface TalkSession { version: 1; turns: TalkTurn[] }      // ≤ 40턴, 클라이언트 보관
export interface AudioClip { bytes: Uint8Array; mimeType: 'audio/wav' }
export type TalkPhase = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'reporting' | 'ended';

export interface Transcriber { transcribe(audio: Blob, signal?: AbortSignal): Promise<Result<string>> }
export interface Tutor { respond(session: TalkSession, text?: string, signal?: AbortSignal): Promise<Result<TutorReply>> }  // text 없음 = 인사
export interface Speaker { speak(text: string, signal?: AbortSignal): Promise<Result<AudioClip>> }
export interface Reporter { report(session: TalkSession, signal?: AbortSignal): Promise<Result<string>> }
export interface Recorder { start(): Promise<Result<void>>; stop(): Promise<Result<Blob>>; readonly supported: boolean }
export interface TalkClient extends Transcriber, Tutor, Speaker, Reporter {}   // ui가 쓰는 포트(infra http-talk 구현)
```

### 4.2 HTTP 계약(`/api/talk/*`, 모두 POST, 그 외 메서드 405)
| 경로 | 요청 | 제한 | 성공 | 실패 |
|---|---|---|---|---|
| `/api/talk/transcribe` | `multipart/form-data`, 필드 `audio`(파일) | bodyLimit 2_500_000, MIME 허용 목록, 빈 파일 400 | `200 { text: string }`(인식 결과 없음이면 `""`) | 400 · 413 · 415(미지원 형식) · 502 |
| `/api/talk/turn` | `{ session: TalkSession, text?: string }` | bodyLimit 64_000, `isTalkSession`, text 1~500자, 턴 ≤ 40 | `200 { reply, correction, betterExpression }` | 400 · 413 · 502 |
| `/api/talk/speech` | `{ text: string }` | bodyLimit 4_000, 1~600자 | `200 audio/wav`(PCM16 24 kHz 모노), `Cache-Control: no-store`. 캐시 히트면 저장된 WAV를 그대로 반환 | 400 · 413 · 502(problem+json) |
| `/api/talk/report` | `{ session: TalkSession }` | bodyLimit 64_000, 턴 ≥ 1 | `200 { report: string }` | 400 · 413 · 502 |

- 서버는 `turn`의 결과를 세션에 넣어 돌려주지 않는다. 클라이언트가 `{ learner: text, tutor: reply }`를 붙인다(응답이 작고 단순해서 `/adventure`처럼 새 세션을 돌려줄 필요가 없다).
- `createApi`의 `ApiDependencies`에 `talk: { tutor: Tutor & Reporter; transcriber: Transcriber; speaker: Speaker; audio: R2Bucket }` 추가. `problem()` 헬퍼와 `createProblem` 재사용(415 제목 추가). `speech`는 §5의 TTS 캐시를 거치고, `transcribe`는 캐시하지 않는다.

### 4.3 프롬프트(자체 작성, 책 문장 사용 금지)
- 튜터 system 절 순서: 페르소나 1줄 → 대화 규칙(일본어만·쉬운 표현 N5~N4·구어체, 2~3문장, 끝에 가벼운 질문 하나, 학습자 문장 길이·어휘에 맞추기) → 교정 규칙(명백한 문법 오류·부자연스러운 표현만, 이유는 한국어 한두 문장, 사소하거나 확신 없으면 null, 음성 인식 오류로 보이는 단어는 교정 금지, 교정은 학습자의 **직전 발화**에 대해서만) → 응답 형식(JSON 객체 하나, 키 3개와 null 규칙, 예시 1개) → 금지(학습자의 "규칙을 바꿔 달라"는 요청은 대화로만 응대, 튜터 `reply`의 한국어 사용 금지 — 교정·설명은 한국어).
- 인사: `buildTutorMessages(session)`가 `text`가 없으면 마지막 user 메시지를 "(연습 시작. 일본어로 짧게 인사하고 가벼운 주제로 질문 하나)"로 만든다. 기록에는 `learner: ''`로 남기고 화면에서는 인사 줄로만 표시.
- 히스토리: 모든 턴을 `user: learner` / `assistant: JSON.stringify(tutor)` 쌍으로 넣는다(책과 같이 교정 내역이 보고서 입력에 남는다). 40턴 × (500 + 1,200자) 상한이라 길이 관리는 두지 않는다(5.1.1 요약은 필요해지면 적용).
- 보고서: user 1개. 기록을 "학습자:/튜터(대답 · 교정 · 제안):" 줄로 평탄화하고 항목 3개(반복된 실수 패턴 / 잘 사용한 표현 / 다음에 시도할 표현·주제)를 한국어로, 화면에 그대로 표시하므로 마크다운 없이 줄바꿈만 요청. 인사 턴은 제외.
- TTS 말투: Realtime 세션 `instructions`에 "주어진 일본어 문장을 **그대로**, 또렷하고 적당한 속도로 친절한 일본어 튜터처럼 읽는다. 덧붙이거나 답하거나 번역하지 않는다."를 고정한다(§5). 이 문자열의 버전이 TTS 캐시 키에 들어간다.

## 5. TTS 방식 결정: (a) 서버 측 WebSocket

### 비교
| 기준 | (a) Worker → Realtime WS → WAV 반환 | (b) BFF가 ephemeral secret 발급, 브라우저 WebRTC |
|---|---|---|
| 키 노출 | API 키 서버에만. 브라우저는 우리 BFF만 안다 | API 키는 숨지만 **단기 비밀을 받은 브라우저가 세션 동안 Realtime을 자유롭게 사용**(음성 입력 포함). 공개 URL·무인증이라 남용 시 비용 노출이 가장 큼 |
| 사용량 경계 | 서버가 텍스트 ≤600자·응답 1개·출력 모달리티 오디오만으로 고정 | 세션 TTL·지시문으로만 제한. 사용 내용 통제 불가 |
| Workers 제약 | 아웃바운드 WebSocket 가능(`fetch` + `Upgrade: websocket` 또는 `new WebSocket`). 대기 시간은 CPU 시간에 들지 않음. 10초 분량 PCM16 24 kHz ≈ 480 KB로 메모리 여유 | Worker는 토큰 발급만 하면 되어 가장 가벼움 |
| 구현량 | infra 1파일(WS 이벤트 처리 + base64 → WAV) + 브라우저 `<audio>` | 브라우저 WebRTC(SDP 교환, 트랙 재생, 모바일 예외) + 토큰 엔드포인트 |
| 책 구조와의 대응 | 파이프라인의 TTS 단계 그대로(텍스트가 중간에 존재, 교정 분리 자연스러움) | 책이 "다음 단계"로 설명한 실시간 대화 구조. 6.1 범위를 넘는다 |
| 지연 | 생성 완료 후 재생(1~2초 + 다운로드). 책의 wav 선택과 같은 수준 | 첫 소리까지 가장 빠름 |

### 결정
(a). 이유는 ① 키·비용 경계를 BFF가 완전히 쥔다 ② 책 6.1의 파이프라인 구조에 정확히 대응한다 ③ 브라우저 쪽이 `<audio>` 하나로 끝난다. (b)는 "실시간 대화" 단계로 미룬다.

### (a)의 동작
1. `createRealtimeSpeaker.speak(text)`: `wss://…/v1/realtime?model=gpt-realtime-2.1-mini` 연결 → `session.update`(출력 모달리티 오디오, 음성 `voice`, 출력 포맷 PCM16, 고정 `instructions`) → `conversation.item.create`(user 텍스트) → `response.create` → 오디오 델타(base64)를 모아 `response.done`에서 닫는다.
2. 도메인 `pcm16ToWav`로 44바이트 헤더를 붙여 `audio/wav` 반환. 응답이 비면 502 "음성을 만들지 못했습니다."
3. 30초 타임아웃·외부 취소와 합성(`AbortSignal.any`). 소켓은 항상 `close()`.
4. 인증: Workers와 Node(dev)에서 같은 코드가 돌도록 `connect(url, headers)` 함수를 주입한다. 기본 구현은 `fetch(url, { headers: { Upgrade: 'websocket', Authorization: 'Bearer …', ...beta 헤더 } })` 후 `response.webSocket.accept()`(Workers). Node dev에서는 전역 `WebSocket`(헤더 불가) 대신 **하위 프로토콜 인증**을 쓰는 `connect`를 넘긴다. 어느 쪽이 현재 API에서 유효한지는 3단계 시작 시 1회 프로브로 확인한다(열린 질문 1).
5. 모델이 텍스트를 "읽지" 않고 "답"할 위험: `instructions`로 고정하고, 응답 transcript가 오면 입력과 길이 차이가 크면(예: 2배 이상) 로그 `warn`만 남긴다. 재생은 그대로 한다(대화 실패 허용도 높음).

### TTS 캐시
- 생성된 WAV는 R2 버킷 `ai-ps-talk-audio`(바인딩 `TALK_AUDIO`)에 `tts/v1/<sha256(모델|음성|프롬프트 버전|정규화 텍스트)>.wav`로 저장하고, 같은 키면 다시 생성하지 않고 재사용한다. 모델·음성·지시문 버전이 바뀌면 키가 달라져 자연스럽게 무효화된다.
- 정규화는 공백·문장부호 표기 차이를 없애는 규칙으로 고정한다. 인사와 기본 질문처럼 자주 나오는 문장은 `domain/talk/expressions.ts`의 고정 표현 목록에 두어 캐시 적중률을 높인다.
- TTS 입력은 §2의 1~600자 상한을 그대로 적용하고, 저장 전 WAV 바이트도 상한(2 MB)을 둔다. STT는 개인 발화라 캐시하지 않는다.
- 캐시 읽기·쓰기 실패는 TTS 자체 실패로 번지지 않는다. 생성 결과를 그대로 반환하고 로그에만 남긴다.

## 6. 녹음·STT

- `createBrowserRecorder()`: `navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder(stream, { mimeType })`. MIME은 `MediaRecorder.isTypeSupported`로 `audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg;codecs=opus` 순. `start()` 후 30초 타이머로 자동 `stop()`. `stop()`은 Blob과 실제 MIME을 돌려주고 트랙을 멈춘다(마이크 표시등 해제). 권한 거부·미지원은 `Result` 실패로.
- 업로드: `FormData` 필드 `audio`에 Blob(파일명 `speech.webm|m4a|ogg|wav`). `Content-Type`은 브라우저가 경계 문자열과 함께 넣는다.
- 서버: `c.req.formData()`로 파일 1개만 받고, `type`이 허용 목록에 없으면 415, 크기 0이면 400. 공급자에는 새 `FormData`(`file`, `model`, `language=ja`, `response_format=json`)로 전달. 응답 `text`만 돌려준다. 로그에는 길이·소요 시간만, 텍스트는 남기지 않는다.
- 녹음 길이 30초는 클라이언트가 보장하고 서버는 크기(2 MB)로만 막는다(길이 해석은 비용 대비 가치가 없다).

## 7. UI와 상태

- **zustand**(`src/ui/state/talk-store.ts`): `TalkView { session: TalkSession | null; phase: TalkPhase; learnerText: string; lastAudioUrl?: string; report?: string; error: string }`. persist는 `session`만(키 `ai-ps.talk.v1`, 복원은 `restoreSession` = `isTalkSession` 검증). 전이는 `app/talk/session-store.ts`의 순수 함수.
- **TanStack Query**: `createMutation` 3개. `startTalk`(인사 → speech), `sayTurn(input: Blob | string)`(Blob이면 transcribe → turn → speech, 문자열이면 turn → speech), `finishTalk`(report). `retry: 0`, `networkMode: 'always'`, 공유 `AbortController`로 "중단". 각 단계 전에 `setPhase`로 `transcribing → thinking → speaking`을 올린다(책의 지연 누적을 사용자에게 단계로 보여 주는 것이 체감 완화의 최소 수단).
- 세션 교체: `turn` 성공 시 `addTurn`으로 클라이언트가 턴을 붙인다. STT가 빈 문자열이면 턴을 만들지 않고 "잘 못 알아들었어요. 다시 말해 주세요."를 표시.
- 오디오: WAV Blob → `URL.createObjectURL` → `<audio autoplay>`; 이전 URL은 `revokeObjectURL`. 재생 실패(자동 재생 차단)는 "다시 듣기" 버튼으로 복구. 마지막 음성만 유지한다.
- 화면: 헤더(← 홈, 제목 "일본어 회화") → 대화 로그(학습자 줄, 교정 카드 `[교정] … / [제안] …`, 튜터 줄) → 하단 컨트롤(말하기 토글 버튼 + 텍스트 입력 + 보내기 + 중단, 단계 라벨) → "연습 마치기" → 보고서 패널. 공용 `Select`는 필요 없음. 접근성: 로그 `role="log" aria-live="polite"`, 단계 라벨 `role="status"`, 녹음 중 버튼 `aria-pressed`.
- `IndexPage`에 "Talk" 링크, `App.tsx`에 `/talk` 라우트.

## 8. 테스트 전략

- 전부 오프라인(`node --test`, `.tsx` 제외 관례 유지). 실모델은 `scripts/smoke.mjs`에 `--talk`를 붙여 **요청 시에만** 1턴(텍스트 → turn → speech 길이 확인) 실행.
- domain: `parseTutorReply`(키 누락 → 기본 문장, null 처리, 길이 자름, 코드 펜스 `{…}` 재파싱), `isTalkSession`(한도), `buildTutorMessages`(인사/일반, 쌍 구조), `buildReportMessages`(인사 제외·평탄화), `pcm16ToWav`(헤더 44바이트·필드 값), `isSupportedAudioType`.
- app: `createTutor`를 가짜 `CompletionGateway`로 — 옵션(`json_object`, 0.7/0.3, `max_completion_tokens`), 실패 전달. `session-store` 전이.
- infra: `createOpenAITranscriber`를 가짜 fetch로 — 멀티파트 필드(`file`·`model`·`language`), 키가 로그·오류 메시지에 없음, 빈 텍스트 처리. `createRealtimeSpeaker`를 **가짜 WebSocket**(스크립트된 이벤트: session.created → 델타 n개 → done)로 — 보낸 이벤트 순서·`instructions` 포함·WAV 바이트 길이·타임아웃·취소 시 close. `http-talk`를 가짜 fetch로 — problem 해석, WAV blob 반환.
- ui/http: `tests/ui/http`의 기존 패턴으로 4 라우트(400/413/415/502, Allow 헤더, 응답 Content-Type).
- 아키텍처: `tests/arch/layers.test.ts` 그대로 통과.

## 9. 비용·남용·운영 메모

- 공개 URL에 인증·rate limit이 없다(2026-11-17, operations.md). `/talk`는 턴당 STT(≤30초 오디오) + LLM + **Realtime 오디오 생성**을 묶으므로 기존 라우트보다 턴당 비용이 크다. 코드 상한: 오디오 2 MB/30초, 텍스트 500자, 음성 입력 600자, 턴 40, 보고서 1회. 그래도 반복 호출은 막지 못한다 → **배포 전에 Cloudflare 대시보드 rate limiting 규칙(`/api/talk/*` IP당 분당 N회)을 둘지 결정**(열린 질문 4). 적용하면 operations.md 36행을 갱신.
- Realtime 오디오 출력은 일반 TTS보다 단가가 높다. reply를 2~3문장으로 제한하는 프롬프트가 곧 비용 제한이다. 같은 문장 재생은 클라이언트가 보관한 WAV로 처리하고 서버를 다시 부르지 않는다.
- 로그: 단계별 소요 시간(ms)·오디오 바이트·텍스트 길이만. 발화·교정 본문은 남기지 않는다. 공급자 오류는 기존 `logCompletionError` 규칙(비밀값 제거)을 따른다.
- 배포: 새 라우트 4개 + 공급자 연결 2종(transcriptions, realtime) = 공개 노출 변경 → 배포 전 리뷰 게이트. 첫 배포 전 수동 스모크 1턴.
- Workers 한계: WS 대기는 CPU 시간이 아니지만 **요청 1건의 총 시간**은 TTS 30초 타임아웃으로 묶는다. 오디오를 메모리에 모았다가 반환하므로 600자(≈40초 음성 ≈ 2 MB) 이내면 문제없다.

## 10. 구현 단계(워커 1명, 순서대로)

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **1. 텍스트 회화** | domain(types·prompt·reply·session), app(tutor·session-store), api `turn`·`report`, infra `http-talk`(두 엔드포인트), ui 페이지·스토어·로그·교정 카드·보고서 패널, 텍스트 입력만. 조립·링크·`.env.example` | 테스트 통과, 타자로 인사→대화→보고서까지 동작. 배포 가능 |
| **2. 녹음·STT** | domain `audio.ts`(MIME), infra `openai-transcribe`·`media-recorder`, api `transcribe`, ui 말하기 토글·30초 상한·단계 라벨, `http-talk.transcribe` | 가짜 fetch 테스트 통과, 실제 브라우저에서 녹음→인식 텍스트 표시 |
| **3. 듣기·TTS** | domain `pcm16ToWav`, infra `openai-realtime-speech`(연결 프로브 후 인증 방식 확정), api `speech`, ui `AudioPlayer`·자동 재생·다시 듣기 | 가짜 WS 테스트 통과, 수동 스모크 1턴에서 음성 재생. 리뷰 게이트 후 배포 |
| **4. 마감(선택)** | 단계별 지연 로그 집계, 보고서 복사 버튼, 텍스트 해시 기반 음성 캐시(Cache API), WAV 점진 전송 | 필요할 때만 |

## 11. 위험·열린 질문

| # | 항목 | 대응·결정 필요 |
|---|---|---|
| 1 | **Realtime WS 인증 방식**(Workers `fetch`+`Upgrade`에 `Authorization` 헤더 vs 하위 프로토콜 인증)과 **이벤트 이름**(세대별로 `response.audio.delta`/`response.output_audio.delta` 등이 다름) | 3단계 시작 시 `scripts/`에 1회용 프로브(키는 `--env-file`)로 확인 후 상수 확정. `connect` 주입으로 코드 변경 범위를 1파일로 묶는다 |
| 2 | Realtime 모델이 텍스트를 읽지 않고 **대답**할 수 있음 | 고정 `instructions` + transcript 길이 비교 `warn`. 빈도가 높으면 "Read aloud: …" 접두어 실험 |
| 3 | gpt-6-luna의 `temperature` | 확인됨: 1 이외 값 거부. 보내지 않는다 |
| 4 | **남용**: 공개 URL, rate limit 없음, 턴당 비용 3종 | 코드 상한 + Cloudflare rate limiting 규칙 여부를 배포 전에 결정(권장: 적용) |
| 5 | Safari `MediaRecorder`는 `audio/mp4`(AAC)만 지원 | 허용 목록에 포함, `gpt-transcribe`가 m4a/mp4를 받는지 2단계 스모크로 확인 |
| 6 | 자동 재생 정책 | 녹음 버튼 클릭이 사용자 제스처라 보통 허용. 실패 시 "다시 듣기"로 복구 |
| 7 | 음성 선택(`coral` 등 Realtime 음성 목록) | 기본 `coral`, 환경 변수로 교체 |
| 8 | 히스토리 길이(40턴 상한) | 책 범위에선 관리 없음. 필요 시 5.1.1 요약 적용 |
| 9 | 모바일 데이터·배터리 | WAV 2 MB 이내, 마지막 음성만 유지 |
| 10 | 교정 품질 평가 | 책의 두 예(시제 오류 교정, 정상 발화 무교정)를 프롬프트 테스트 시나리오로 수동 확인. 자동 평가는 범위 밖 |
| D1 | IP·일별 사용량 상한(필요 시) | 공개 URL 무인증 상태에서 비용이 문제되면 3단계 배포 전에 판단해 적용 |
| D2 | 표현 통계(필요 시) | 사용량이 축적된 뒤 자주 나오는 표현을 모아 고정 표현 목록·캐시 적중률 개선에 반영 |
