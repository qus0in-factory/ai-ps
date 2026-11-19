# 에이전트 구성 및 모델 라벨 (ai-ps)

이 문서는 자주 바뀌는 에이전트 구성·모델·역할·라벨의 현재 정본이다. 절차는 `herdr-orchestration`·`herdr-label-models` 스킬, 스크립트 사용법은 `operations.md`를 따른다.

## 에이전트 구성 (2026-11-19 기준)
| 에이전트 | 역할 | 도구·모델 | 기본 effort |
|---|---|---|---|
| `ps-opus` | 사용자 응대·총괄·분배·병합·릴리스·배포·Discord 보고. 구현은 워커에 맡기고, 직접 구현은 사용자가 지시한 경우로 한정한다("한 파일 10줄 이내"는 제안이며 사용자 결정 대기) | Claude Code (Opus 5.5) | — |
| `ps-sol` | 백엔드·인프라(Workers, wrangler)·까다로운 디버깅 | Codex (`GPT-6.1-Sol`, Fast) | high(세션 한정) |
| `ps-glm` | domain·app 구현 | OpenCode (`GLM-5.3`, 공급자 OpenCode Go) | high |
| `ps-ds` | 경량 구현·UI 컴포넌트·스크립트·하네스 | OpenCode (`DeepSeek V4.1 Flash 1017`, 공급자 Ollama Cloud) | high |
| `ps-hf` | 문서 동기화·소규모 구현·가벼운 확인 | OpenCode (`Hy4 flash Free`, 공급자 OpenCode Go) | Default |
| `ps-astra` | 리뷰 전용(구현 코드). 파일 수정·커밋 금지. 결과는 `/tmp/astra-<주제>.md` | Codex (`GPT-6-Astra`, Fast) | high |
| `ps-fable` | 설계·리뷰 전용. 파일 수정·커밋 금지. 결과는 `/tmp/fable-<주제>.md` | Claude Code (`Fable 5.1`) | high |
| `ps-beam` | 별도 트랙 경량 구현·후속 수정. 신호·동시성·정리 보장처럼 까다로운 작업은 맡기지 않는다(2026-11-17 verify-head 3회 반려) | OpenCode (`Beam Free`, 공급자 OpenCode Go, 기본 모델) | Default |

- 모델·fast 모드 변경은 사용자가 한다. effort는 총괄이 작업 성격에 맞춰 세션 한정으로 바꿀 수 있다(Codex는 `s`, enter 금지). 재시작 뒤에는 상태줄에서 effort를 다시 확인한다.

## 배치 규칙
- 워커는 각자 **새 탭**에 연다(`scripts/herdr-open-worker.sh`). split은 사용자가 "같은 탭에"라고 말할 때만.
- 열자마자 모델 선택과 라벨링을 끝낸 뒤 지시를 보낸다. OpenCode는 기본 모델(Beam)로 뜨므로 모델 선택 전에는 지시를 보내지 않는다. 단 `ps-beam`은 `scripts/herdr-open-worker.sh ps-beam opencode beam-free --keep-model --model-label 'Beam Free'`로 연다. `/models`를 건너뛰고 상태줄만 확인한 뒤 라벨링한다(수동 rename 금지).
- 위임 단위: 한 지시는 워커가 5분 안에 끝낼 크기로 자른다. 쪼갤 수 없으면 최대 15분. 실모델 스모크·느린 테스트도 이 시간에 포함한다. 넘을 것 같으면 단계로 나눠 순서대로 보내고, 지시에 "예상 5분/15분"을 적는다.
- 교차 리뷰: 리뷰어는 구현자와 모델 계열이 다른 에이전트로 고른다. 계열은 OpenAI(`ps-sol`·`ps-astra`), Anthropic(`ps-opus`·`ps-fable`), DeepSeek(`ps-ds`), Hy4(`ps-hf`), GLM(`ps-glm`), Beam(`ps-beam`). 기본 짝은 OpenAI 구현→`ps-fable` 리뷰, GLM 구현→`ps-fable` 리뷰, Anthropic·DeepSeek·Hy4·Beam 구현→`ps-astra` 리뷰. 같은 계열밖에 없을 때만 예외로 하고 보고에 적는다.
- watcher(`worker-watcher`)는 워커 1명당 1개. 지시에 워커 이름·결과 파일 경로·전송 시각을 준다.
- 같은 작업 트리에서 여러 워커가 일할 때 지시에 "다른 워커 담당 파일" 목록을 넣는다(지시 템플릿 참고).
- 워커 완료 보고의 테스트 목록은 실제 파일과 대조한다(watcher가 `grep`으로 확인). 보고와 실제가 다르면 같은 워커에 한 번 더, 반복되면 다른 워커로 승계.

## 지시 템플릿 (`/tmp/ps-prompts/<워커>.md`)
```
[<워커> 작업] <한 줄 목표>. 원자료: <경로>.
만들 것: …
범위: <담당 파일·디렉터리>. 다른 워커 담당(건드리지 말 것): <워커>: <파일>, …
금지: 커밋, 배포, <기타>.
pnpm은 --config.store-dir=/Users/young-mini/Library/pnpm/store로 실행하고 .pnpm-store를 만들지 않는다.
완료: `pnpm test`·`pnpm typecheck`(·`pnpm build`) 통과. 끝나면 변경 파일 목록과 요약만 /tmp/<워커>-<주제>.md에 쓰고 경로 보고.
```

## 모델 약칭 및 감지 매핑
- 접두어 `ps-`. Codex는 상태줄 `GPT-6.1-Sol`→`sol`, `GPT-6-Astra`→`astra`(agent 필드만으로 판정하지 않는다). OpenCode는 `DeepSeek <버전>`→`ds`, `Hy4 flash`→`hf`, `GLM-<버전>`→`glm`, `Beam Free`→`beam`(`ps-beam` 외 워커에서는 미선택 상태로 취급). Claude는 `Opus|Fable <버전>`→`opus`|`fable`.
- 정본 패턴은 `scripts/herdr-label-models.sh`의 `detect()`다.
