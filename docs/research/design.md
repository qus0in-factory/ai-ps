# /research 구현 설계 — 자동 리서치 에이전트

작성: ps-hf, 2026-11-19. 근거: `analysis.md`(책 7.1의 원칙), ps-opus 확정 계약(`/tmp/ps-prompts/research-contract.md`), ai-ps 현재 코드(Solid + Hono BFF + Cloudflare Workers, ui/app/domain/infra). 책 범위(싱글턴, 에이전트 주도 루프, 도구 2종, 조사 노트 → 보고서)에 맞춘 설계다. 책 예제의 ddgs·trafilatura는 각각 Brave 검색·fetch 기반 본문 추출로 대체했다. NCP는 2026-11-19 탐색에서 CLOVA Summary·Maps geocode가 모두 401을 반환해 사용할 수 없었고, 이번 배포는 Brave 검색만 사용한다.

## 0. 결정 요약

| 항목 | 결정 |
|---|---|
| 라우트 | `/research`. API는 `POST /api/research` **1개** |
| 응답 형식 | JSON `{ report, steps, sources, iterations, capped }`(200). 오류는 `{ "error": string }`(4xx/5xx, 원문·키 미노출) |
| 주제 | trim 후 **1~200자**. 그 외 400 |
| 모델 호출 | Function Calling. 조사 온도 **0.2**, 보고서 온도 **0.3**, 추론 없음(책 값 유지) |
| 루프 | 에이전트 주도(자율성 레벨 3). 도구 2종 `search_web`·`read_webpage`. `max_iterations=10` 상한 도달 시 **tools 없이** "정리" 요청으로 마무리 |
| 검색 | **Brave Search API**. `.env` `BRAVE-SEARCH-API-KEY` → Workers secret `BRAVE_SEARCH_API_KEY`(책의 ddgs 대체) |
| 본문 읽기 | **fetch + HTML 본문 추출**(책의 trafilatura 대체). 결과는 제목·주소·요약 정돈 텍스트, 본문 4,000자 절단 |
| NCP | **이번 배포 미사용**. 2026-11-19 탐색에서 CLOVA Summary(text-summary)·Maps geocode가 모두 **401** → 현재 키로 사용 가능함을 확인하지 못함. Brave 검색만 사용. `.env` `X-NCP-APIGW-API-KEY-ID`·`X-NCP-APIGW-API-KEY` → secret `NCP_API_KEY_ID`·`NCP_API_KEY` **매핑만 두고 업로드하지 않는다**. 콘솔 앱·API 이용 설정 확인 후 재검토(Summary는 입력 2,000자 상한이라 4,000자 본문 분할 필요) |
| 세션 | 싱글턴, 서버 무상태(요청 1회로 조사 → 보고서까지 완결). 중간 대화 없음 |
| 테스트 | `tests/<layer>/research/`에 테스트 먼저(BDD 서술). 가짜 fetch·가짜 CompletionGateway로 전부 오프라인 |
| 단계 | 1 도메인 규칙·루프 → 2 API·어댑터 → 3 UI. 각 단계에서 테스트 먼저 |

## 1. 사용자 흐름

1. `/research` 진입 → 주제 입력(1~200자) → "조사 시작".
2. 서버가 조사 루프를 돌린다. 화면에는 진행 단계와 도구 호출 로그(`steps`)를 보여줄 수 있다(도구 이름·인자·성공 여부만, 원문·키는 표시하지 않는다).
3. 완료되면 마크다운 보고서(`report`), 참고 자료(`sources`), 도구 호출 기록(`steps`), 반복 횟수(`iterations`), 상한 도달 여부(`capped`)를 표시한다.
4. "새 조사"로 주제를 바꿔 다시 요청한다. 세션 히스토리는 없다(싱글턴).

## 2. 도메인 규칙과 한도

| 항목 | 값 |
|---|---|
| 주제 | trim 후 1~200자. 빈 값·초과 시 400 |
| 루프 상한 | `max_iterations=10`. 상한 도달 시 `capped=true` |
| 도구 | `search_web`·`read_webpage` 2종. 정의되지 않은 도구 호출은 실패 문자열로 처리 |
| 출처 확인 | 서로 다른 출처 3개 이상 권고(시스템 프롬프트 지시) |
| 조사 노트 | 각 항목에 출처 URL 동봉. 확인된 내용만 기록(추측·사전 지식 보충 금지) |
| 본문 절단 | 4,000자(비용·정보량 트레이드오프, 책 값 유지) |
| 보고서 구성 | 개요 → 주요 내용 → 시사점 → 참고 자료. 주요 내용 각 항목에 근거 URL, 참고 자료에 사용한 모든 출처 |
| 실패 처리 | 검색·본문 추출 실패는 예외가 아니라 안내 문자열로 반환해 에이전트가 재시도하게 한다 |
| 응답 검증 | 클라이언트가 `report`·`steps`·`sources`·`iterations`·`capped`의 타입·길이·개수를 검증한다(현재 `http-research.ts`의 상한 준수) |

## 3. 레이어 배치(파일)

```
src/domain/research/     [ps-glm]
  types.ts    ResearchTopic · ResearchStep · ResearchNote · ResearchResult · 포트(Researcher, SearchTool, PageReader)
  prompt.ts   RESEARCH_SYSTEM_PROMPT · buildReportPrompt(notes)
  tools.ts    도구 정의(이름·description·파라미터) · description 문자열 상수
  notes.ts    출처 URL 동봉 규칙 · 노트 정규화
  loop.ts     max_iterations · 종료 판단 · 상한 마무리 지시문

src/app/research/        [ps-sol]
  researcher.ts  createResearcher(gateway, tools): Researcher  — 조사 루프 + 보고서 호출
  service.ts     조사 결과 조립(steps·sources·iterations·capped)

src/infra/               [ps-sol / ps-ds]
  research-brave-search.ts  createBraveSearch(...): SearchTool  [ps-sol]
  research-page-reader.ts   createPageReader(fetcher): PageReader  [ps-sol — fetch + 본문 추출]
  http-research.ts          createHttpResearch(fetcher): ResearchClient  [ps-ds]

src/ui/
  pages/ResearchPage.tsx           [ps-ds]
  widgets/research/                [ps-ds] ResearchWidget · 입력 · 로그 · 보고서 패널
  http/api.ts                      POST /api/research 추가  [ps-sol]

src/worker.ts             ApiDependencies에 researcher 주입 + 라우트 등록  [ps-sol]
scripts/deploy.mjs        배포 스크립트  [ps-sol]
tests/<layer>/research/   도메인·app·infra·ui 계층별 테스트  [ps-glm 외 각 담당]
```

- 조립: `src/worker.ts`에 `research: createResearcher(model, ...)`와 Brave·페이지 리더 어댑터를 주입한다. `src/main.tsx`에는 `createHttpResearch()`를 주입한다. `src/agent.ts`(CLI)는 건드리지 않는다.
- 레이어 규칙: domain은 외부 import 없음. ui의 domain import는 타입 전용. infra는 app이 주입받는다(`tests/arch`가 강제).
- 담당 구분: ps-sol = `src/infra`·`src/app`·`src/worker.ts`·`scripts/deploy.mjs`, ps-glm = `src/domain/research`·`tests/domain/research`, ps-ds = `src/ui`·`src/infra/http-research.ts`, ps-beam = `scripts/herdr-*`·`scripts/lib`·`tests/scripts`. 이 문서(`docs/research/`)는 범위 밖 파일을 수정하지 않는다.

## 4. HTTP 계약

`POST /api/research` (그 외 메서드 405)

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "topic": string }` — trim 후 1~200자. bodyLimit은 JSON 본문 크기에 맞춘다 |
| 성공(200) | `{ "report": string(markdown), "steps": [{ "tool": "search_web" \| "read_webpage", "args": object, "ok": boolean }], "sources": string[], "iterations": number, "capped": boolean }` |
| 실패(4xx/5xx) | `{ "error": string }` — 사유를 담되 **요청 원문·API 키·공급자 원문은 노출하지 않는다** |
| 400 | 주제 길이 위반·빈 값 |
| 429 | 과도한 요청(클라이언트는 "잠시 후 다시 시도"로 표시) |
| 502 | 조사·보고서 생성 실패 |

- `steps`는 도구 호출 순서대로 쌓고, 실패한 호출도 `ok: false`로 기록한다(디버깅·관찰용).
- `sources`는 조사 노트에 기록된 URL을 중복 제거해 모은다. `iterations`는 실제 반복 횟수, `capped`는 상한 도달로 마무리했는지 여부다.
- `createApi`의 `ApiDependencies`에 `research`를 추가하고, 기존 `problem()` 헬퍼를 재사용한다(오류 본문은 `{ error }` 형태로 통일).

## 5. 검색·본문 읽기 어댑터

### Brave Search API (책의 ddgs 대체)
- 책은 API 키 없이 쓸 수 있는 ddgs를 썼지만, 비공식 엔진이라 차단·동작 변화 위험이 있고 책도 프로덕션에는 상용 API를 권장한다. ai-ps는 **Brave Search API**를 쓴다.
- 키: `.env`의 `BRAVE-SEARCH-API-KEY`를 Workers secret `BRAVE_SEARCH_API_KEY`로 등록한다. 키는 서버에만 두고 로그·오류 메시지·응답에 넣지 않는다.
- 반환값은 도구 설계 원칙 2에 따라 **제목·주소·요약이 구분된 정돈된 문자열**로 변환한다. 실패·결과 없음은 안내 문자열로 반환한다(원칙 3).

### fetch + HTML 본문 추출 (책의 trafilatura 대체)
- `fetch(url)`로 HTML을 받아 메뉴·광고·댓글·푸터 같은 잡음을 제거하고 본문 텍스트만 남긴다. 추출 실패 시 "다른 페이지를 시도해보세요"류 안내 문자열을 반환한다.
- 본문은 **4,000자**로 자른다(책 값). 글자 수 기준이므로 언어별 토큰 소비량 차이가 있음을 감안한다.
- 브라우저가 아닌 서버에서 동작하므로 JS 렌더링 페이지·로그인 필요 페이지는 읽지 못할 수 있다(책의 한계 2와 같음). 오류를 문자열로 돌려 에이전트가 다른 페이지로 넘어가게 한다.

### NCP — 이번 배포 미사용, 재검토 대기

- 2026-11-19 탐색 결과: CLOVA Summary(text-summary)와 Maps geocode(기존 naveropenapi 게이트웨이)가 모두 **401**을 반환했다. 현재 키로 두 API를 사용할 수 있다는 것을 확인하지 못했다. Brave Web Search는 200으로 구현에 사용 가능하다.
- 따라서 **이번 배포는 Brave 검색만 사용한다**. NCP 호출 어댑터는 추가하지 않는다. 401 두 건만으로 다른 NCP 서비스의 키 무효를 단정할 수는 없다.
- `.env`의 `X-NCP-APIGW-API-KEY-ID`·`X-NCP-APIGW-API-KEY` → Workers secret `NCP_API_KEY_ID`·`NCP_API_KEY` **매핑만 두고, secret은 업로드하지 않는다**.
- 재검토 조건: 콘솔에서 앱·API 이용 설정을 확인한 뒤 별도 검증한다. CLOVA Summary를 조사 노트 압축 보조 단계로 쓸 경우 공식 입력 상한이 **2,000자**여서 현재 4,000자 본문을 그대로 보낼 수 없다. 분할·문장 경계 처리와 원문 URL 보존이 필요하다.

## 6. 도구·프롬프트 계약(domain)

- 도구 `description`은 **무엇을 하는지 + 언제 쓰는지 + 다른 도구와의 관계**를 적는다.
  - `search_web`: "웹에서 검색하고 제목·주소·요약 목록을 반환한다. 자세한 내용이 필요하면 결과 주소를 `read_webpage`로 읽는다."
  - `read_webpage`: "검색 결과의 요약만으로 부족할 때, 출처로 인용할 내용을 확인할 때 쓴다."
- 조사 시스템 프롬프트: 주제 파악·검색 계획 → `search_web` → 중요 페이지는 `read_webpage`로 직접 읽기(요약만으로 판단 금지) → 서로 다른 출처 3개 이상 → 충분하면 도구 호출 중단하고 정리. 노트에는 URL을 함께 기록하고 확인된 내용만 적는다.
- 조사 호출: tools 포함, 온도 0.2, 추론 없음. 도구 호출이 없으면 조사 완료로 보고서 단계로 넘어간다.
- 상한 호출: tools를 넘기지 않고 "지금까지 수집한 정보를 정리" 지시를 user 메시지로 추가한다(마무리 보장).
- 보고서 호출: 조사 노트만 입력, 온도 0.3, 추론 없음. 개요·주요 내용·시사점·참고 자료 순, 노트에 없는 사실 금지, 각 항목에 출처 URL, 참고 자료에 모든 출처.

## 7. 테스트 전략 (layered-tdd — 테스트 먼저)

새 코드는 각 레이어의 테스트를 **먼저** 작성하고 BDD 서술(given/when/then)으로 의도를 남긴 뒤 구현한다. 전부 오프라인(`node --test`), 실서비스 호출은 수동 스모크로만 한다.

- `tests/domain/research/` [ps-glm]: 도구 정의의 description에 사용 시점·도구 관계가 포함되는가, 조사 노트가 URL 없이 거부되는가, 추측 보충이 금지되는가, 상한 도달 시 tools 없는 마무리 지시가 만들어지는가, 보고서 프롬프트에 네 항목·출처 규칙이 들어가는가.
- `tests/app/research/`: 가짜 CompletionGateway로 도구 호출이 `steps`에 순서대로 기록되는가, 실패 호출이 `ok: false`로 남는가, `capped`가 정확한가, 실패가 `{ error }`로 전달되는가.
- `tests/infra/`: Brave 검색 어댑터(가짜 fetch — 제목·주소·요약 정돈, 키 비노출), 페이지 리더(가짜 HTML — 잡음 제거·4,000자 절단·실패 문자열), `http-research`(가짜 fetch — 200 검증, 400/429/502 해석, 타입·길이 위반 거부, 키·원문 미노출).
- `tests/ui/http/`: `POST /api/research` 라우트(400/405/502, 응답 `{ error }`, Content-Type).
- `tests/arch/layers.test.ts`: 레이어 의존 방향(ui→app→domain, infra는 주입) 그대로 통과.

## 8. 운영·보안 메모

- 키는 Workers secret에만 둔다. `.env` 값을 출력·로그에 남기지 않고, supplier 오류 메시지에서 비밀값을 제거한다(`logCompletionError` 규칙).
- 로그에는 주제 길이·도구 호출 횟수·소요 시간·반복 횟수만 남기고, 검색어 원문·페이지 본문·보고서 본문은 남기지 않는다.
- 조사는 최대 10회 반복에 검색·페이지 읽기·LLM 호출이 묶이므로 요청당 시간이 길다. 클라이언트 타임아웃은 이에 맞춰 넉넉히 잡는다(현재 `http-research.ts`는 600초).
- 공개 URL에 인증이 없으므로 남용 대비가 필요하다. 코드 상한(주제 200자, 반복 10회, 본문 4,000자)만으로는 반복 호출을 막지 못한다 — 필요 시 Rate Limiting 검토.
- 새 라우트 1개 + 외부 공급자(Brave) 연결 = 공개 노출 변경이므로 배포 전 리뷰 게이트를 따른다(`docs/harness/operations.md`).
- 배포·커밋·스크립트 수정은 이 문서의 범위가 아니다(ps-sol·ps-beam 담당).
