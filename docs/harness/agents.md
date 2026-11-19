# 에이전트 구성 및 모델 라벨 (ai-ps)

이 문서는 자주 바뀌는 에이전트 구성·모델·역할·라벨의 현재 정본이다. 이 저장소에서는 역할·범위를 이 문서에 따르고, Herdr 조작은 `herdr-orchestration`·`herdr-label-models` 스킬과 `operations.md`를 참고한다.

## 에이전트 구성 (2026-11-19 기준)
| 에이전트 | 역할 | 도구·모델 | 기본 effort |
|---|---|---|---|
| `ps-opus` | 사용자 응대·분배·감시·병합·릴리스·배포·Discord 보고. 책 이미지 판독, 코드·외부 API 탐색, 구현, 문서 작성은 워커에 맡긴다. 설계·우선순위·위험 판단은 `ps-fable`에 위탁하고 결과를 따른다. 사용자가 직접 작업을 지시한 경우에만 예외로 한다. | Claude Code (Opus 5.5) | low (사용자 지정) |
| `ps-sol` | 백엔드·인프라(Workers, wrangler)·까다로운 디버깅 | Codex (`GPT-6.1-Sol`, Fast) | high(세션 한정) |
| `ps-glm` | domain·app 구현 | OpenCode (`GLM-5.3`, 공급자 OpenCode Go) | high |
| `ps-ds` | 경량 구현·UI 컴포넌트·스크립트·하네스 | OpenCode (`DeepSeek V4.1 Flash 1017`, 공급자 Ollama Cloud) | high |
| `ps-hf` | 문서 동기화·소규모 구현·가벼운 확인 | OpenCode (`Hy4 flash Free`, 공급자 OpenCode Go) | Default |
| `ps-astra` | 리뷰 전용(구현 코드). 파일 수정·커밋 금지. 결과는 `/tmp/astra-<주제>.md` | Codex (`GPT-6-Astra`, Fast) | high |
| `ps-fable` | 설계·리뷰 전용. 파일 수정·커밋 금지. 결과는 `/tmp/fable-<주제>.md`. 문제가 없다고 판단한 항목에는 공식 문서 링크 또는 실측 근거를 붙인다. 근거가 없으면 미확인으로 둔다. | Claude Code (`Fable 5.1`) | high |
| `ps-beam` | 별도 트랙 경량 구현·후속 수정. 신호·동시성·정리 보장처럼 까다로운 작업은 맡기지 않는다(2026-11-17 verify-head 3회 반려) | OpenCode (`Beam Free`, 공급자 OpenCode Go, 기본 모델) | Default |

- 모델·fast 모드 변경은 사용자가 한다. effort는 총괄이 작업 성격에 맞춰 세션 한정으로 바꿀 수 있다(Codex는 `s`, enter 금지). 재시작 뒤에는 상태줄에서 effort를 다시 확인한다.

## 배치 규칙
- **세션 시작 순서**. ① `SELF_LABEL=ps-opus scripts/herdr-label-models.sh`로 자기 패널 라벨을 확인한다. ② `herdr agent list`로 기존 워커를 확인한다. ③ 필요한 워커를 연다. 열기 스크립트가 실패하면 수동으로 열고 스크립트 수정은 별도 작업으로 기록한다. ④ `/tmp/ps-prompts/<주제>-contract.md`에 요청 범위를 한 줄로 적는다. ⑤ 첫 지시를 보낸다. 총괄은 지시를 보내기 전에 저장소 파일·책 이미지를 탐색하지 않는다.
- **요청 범위**. 계약과 지시에 요청 범위와 범위 밖 제안을 나눠 적는다. 하드닝·OG·스크립트 정비·rate limit·선행 리뷰·문서 갱신이 요청 범위 밖이면 제안으로 적고 사용자 결정 뒤 착수한다. 첫 기능 릴리스에 포함되지 않은 OG와 README 갱신은 같은 메이저의 다음 패치까지 반영한다.
- **첫 마일스톤**. 사용자가 로컬에서 `pnpm dev`로 실행할 수 있는 상태를 먼저 만들어 보고한다. 이후 리뷰·배포와 후속 보강을 진행한다.
- **비밀키와 외부 계정**. 키의 용도·상품·한도를 모르면 사용자에게 한 줄로 묻고 답을 기다리는 동안 미확정으로 남겨 다른 작업을 진행한다. 용도를 추측해 외부 API를 호출하지 않는다. 2026-11-19 NAVER 검색 키로 Summary·Maps를 호출해 401이 발생했다.
- **리뷰 중단과 배포**. 사용자가 즉시 배포를 지시해 blocker 수정을 중단하면 커밋 메시지와 Discord 검증란에 blocker ID와 미반영 사실을 기록하고 다음 패치의 첫 항목으로 올린다. 중단 지시를 받은 워커도 결과 파일에 반영·미반영 항목을 한 줄로 남긴다.
- 워커는 각자 **새 탭**에 연다(`scripts/herdr-open-worker.sh`). split은 사용자가 "같은 탭에"라고 말할 때만.
- 열자마자 모델 선택과 라벨링을 끝낸 뒤 지시를 보낸다. OpenCode는 기본 모델(Beam)로 뜨므로 모델 선택 전에는 지시를 보내지 않는다. 단 `ps-beam`은 `scripts/herdr-open-worker.sh ps-beam opencode beam-free --keep-model --model-label 'Beam Free'`로 연다. `/models`를 건너뛰고 상태줄만 확인한 뒤 라벨링한다(수동 rename 금지).
- 위임 단위: 한 지시는 워커가 5분 안에 끝낼 크기로 자른다. 쪼갤 수 없으면 최대 15분. 실모델 스모크·느린 테스트도 이 시간에 포함한다. 넘을 것 같으면 단계로 나눠 순서대로 보내고, 지시에 "예상 5분/15분"을 적는다.
- 교차 리뷰: 리뷰어는 구현자와 모델 계열이 다른 에이전트로 고른다. 계열은 OpenAI(`ps-sol`·`ps-astra`), Anthropic(`ps-opus`·`ps-fable`), DeepSeek(`ps-ds`), Hy4(`ps-hf`), GLM(`ps-glm`), Beam(`ps-beam`). 기본 짝은 OpenAI 구현→`ps-fable` 리뷰, GLM 구현→`ps-fable` 리뷰, Anthropic·DeepSeek·Hy4·Beam 구현→`ps-astra` 리뷰. 같은 계열밖에 없을 때만 예외로 하고 보고에 적는다.
- watcher(`worker-watcher`)는 워커 1명당 1개. 지시에 워커 이름·결과 파일 경로·전송 시각을 준다.
- 같은 작업 트리에서 여러 워커가 일할 때 지시에 "다른 워커 담당 파일" 목록을 넣는다(지시 템플릿 참고).
- 워커 완료 보고의 테스트 목록은 실제 파일과 대조한다(watcher가 `grep`으로 확인). 보고와 실제가 다르면 같은 워커에 한 번 더, 반복되면 다른 워커로 승계.

## 지시 템플릿 (`/tmp/ps-prompts/<워커>.md`)
```
[<워커> 작업] <한 줄 목표> (예상 5분/15분) · 발신 ps-opus · 요청 범위 <사용자 요청 한 줄> · 원자료 <경로>
만들 것: …
담당 파일·디렉터리: … / 다른 워커 담당(수정 금지): …
범위 밖 제안: 발견한 사항은 결과 파일에만 기록한다.
금지: 커밋, 배포, .env 값 출력, 사용자가 확인하지 않은 외부 API 호출, <기타>.
pnpm은 --config.store-dir=/Users/young-mini/Library/pnpm/store로 실행하고 .pnpm-store를 만들지 않는다.
완료: pnpm test·pnpm typecheck(·pnpm build) 통과. 변경 파일, 요약, 반영·미반영 항목을 /tmp/<워커>-<주제>.md에 쓰고 경로만 보고한다. 중단 시에도 결과 파일을 남긴다.
```

## 모델 약칭 및 감지 매핑
- 접두어 `ps-`. Codex는 상태줄 `GPT-6.1-Sol`→`sol`, `GPT-6-Astra`→`astra`(agent 필드만으로 판정하지 않는다). OpenCode는 `DeepSeek <버전>`→`ds`, `Hy4 flash`→`hf`, `GLM-<버전>`→`glm`, `Beam Free`→`beam`(`ps-beam` 외 워커에서는 미선택 상태로 취급). Claude는 `Opus|Fable <버전>`→`opus`|`fable`.
- 정본 패턴은 `scripts/herdr-label-models.sh`의 `detect()`다.
