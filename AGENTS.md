# AGENTS.md
- 이 파일은 매 세션 토큰에 포함된다. 한 줄 포인터만 두고 상세 절차는 스킬에 둔다 (작성법: `agents-md-authoring` 스킬).
- Herdr 탭·패널·에이전트는 워크스페이스 접두어 `ps-` + 모델 약칭으로 라벨링한다(예: `ps-opus`, `ps-sol`). 라벨링 시 `herdr-label-models` 스킬.
- 워커에 작업을 분배·감시·검수할 때는 `herdr-orchestration` 스킬.
- 패키지 매니저는 pnpm. 문서는 `docs/`.
- 코드는 `src/`의 `ui/app/domain/infra` 레이어(의존은 ui→app→domain, infra는 app이 주입, `tests/arch`가 강제). TDD/BDD로 `tests/`에 테스트 먼저 작성 — `layered-tdd` 스킬.
- 완료 조건: `pnpm test`·`pnpm typecheck`·`pnpm build` 통과.
- 작업 완료 보고는 Discord로 — `discord-notify` 스킬, 절차·스크립트는 `docs/harness/operations.md`.
- 에이전트 구성·역할·effort·지시 템플릿은 `docs/harness/agents.md`, 워커 열기·릴리스·배포·pnpm과 공개 노출 변경 배포의 리뷰 게이트는 `docs/harness/operations.md` 스크립트(`scripts/`) 기준.
