# 운영 절차

## Discord 완료 보고
- 사용자가 요청한 작업 묶음이 끝나면 총괄(`ps-opus`)이 한 번 보낸다. 워커는 보내지 않는다. 메시지 구조는 `discord-notify` 스킬을 따른다.
- 스크립트: `scripts/notify-discord.sh "<제목>" "<본문>" [--image <경로>]... [--dry-run]` (본문 `-`는 stdin). 프로젝트 루트에서 실행한다.
- 웹훅은 `.env`의 `DISCORD_WEBHOOK_URL`에서 읽는다(`.env`는 커밋 금지, 키 이름만 `.env.example`에 둔다). 값을 `echo`·`cat`으로 출력하지 않는다.
- 순서: `--dry-run`으로 payload 확인 → 전송 → `전송 완료`(HTTP 204/200) 확인.
- 제목은 `[ai-ps <버전·작업명>] <한 줄 결과>`, 본문은 바뀐 것·검증·판정해 주세요·다음 순서로 쓴다. 검증에는 리뷰 수행 여부와 리뷰어·결과 파일, 생략 여부, 미반영 blocker·major의 ID와 요약, workerd 검증과 운영 POST 확인 여부를 적는다. 다음 항목에는 사용자가 선택할 범위 밖 제안을 적는다.

## 워커 열기·라벨·전송·effort
- 세션 시작 시 [배치 규칙](agents.md#배치-규칙) 순서로 자기 패널 라벨과 기존 워커 목록을 확인한다. 현재는 라벨 스크립트와 `herdr agent list`·`herdr pane list`를 사용한다.
- 검증된 상태줄 기준은 OpenCode 2.3.2와 Codex 0.170이다. Claude Code는 모델 선택 방식이 다르므로 현재 스크립트의 Claude 분기를 따른다. CLI를 올린 뒤 자동 열기가 실패하면 현재 패널의 상태줄을 확인해 수동으로 열고, 모델을 선택해 라벨을 붙인다. 스크립트 수정은 별도 패치로 기록한다.
- 열기: `scripts/herdr-open-worker.sh <ps-이름> <codex|claude|opencode> <model> [effort] [옵션]`. 기본은 새 탭이고, 같은 이름이 `herdr agent list`에 있으면 열지 않는다. `--split-of <pane>`는 사용자가 "같은 탭에"라고 말할 때만 쓴다. effort 기본값은 codex·claude가 high, opencode는 variant 목록이 보일 때만 쓴다. `--model-label '<문구>'`는 화면에 보이는 모델 표기다(slug와 다를 때). `--dry-run`으로 명령·키 순서를 먼저 확인한다.
- 열기 스크립트가 지원하지 않는 CLI(grok·agy)는 `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <저장소> --label <ps-이름>`으로 연다. `--workspace` 없이 만들면 포커스된 워크스페이스에 탭이 생긴다(2026-11-19 w2Q에 생성). 연 뒤 `herdr agent list`에서 `workspace_id`를 확인한다.
- OpenCode 모델 선택: 실행 후 `/models` → 검색어 → enter → variant를 화면 폴링으로 진행한다. 같은 이름이 두 공급자에 있으므로 `--provider '<문구>'`로 공급자 줄을 지정한다(ps-ds는 Ollama Cloud, ps-hf는 OpenCode Go). 끝나면 상태줄에 모델명(effort는 `· high` 접미)이 보이는지 `--expect`로 확인한다.
- OpenCode 기본 모델(Beam Free)을 그대로 쓰는 워커는 `--keep-model`로 연다(예: `scripts/herdr-open-worker.sh ps-beam opencode beam-free --keep-model --model-label 'Beam Free'`). `/models`를 건너뛰고 상태줄만 확인한 뒤 라벨링한다. effort·`--provider`는 확인 조건일 뿐 설정이 아니다.
- 상태줄 판정: OpenCode 2.3.2·Codex 0.170에서는 마지막 줄이 아니라 OpenCode는 `Build` 포함 줄, Codex는 경로(`~/`)·중간점(`·`) 표기가 있는 줄을 보고, OpenCode 첫 실행 대기는 60초다(`herdr_status_line`·`herdr_wait_for`; 근거 `/tmp/ps-beam-herdr.md`).
- 라벨: `scripts/herdr-label-models.sh [--dry-run] [--force] [--prefix ps-] [workspace_id]`. 수동 rename 금지. claude 패널은 화면에 모델명이 없어 감지가 안 되므로, 스크립트를 실행하는 패널에는 `SELF_LABEL=ps-opus`를 붙인다. 정본 매핑은 스크립트의 `detect()`다.
- Claude 패널 rename: 이름이 등록되기 전에는 `herdr agent rename`이 실패할 수 있다. 화면에서 패널 이름이 등록된 것을 확인한 뒤 같은 명령을 다시 실행한다(자동 라벨 스크립트의 rename과 별개).
- 전송: 지시를 `/tmp/ps-prompts/<워커>.md`에 quoted heredoc으로 쓰고 `scripts/herdr-send.sh <워커> <파일>`로 보낸다. `printf` 조립 금지, `--dry-run` 지원. watcher(`worker-watcher`)는 워커 1명당 1개이고, 지시에 워커 이름·결과 파일 경로·전송 시각을 적는다.
- effort: `scripts/herdr-set-effort.sh <워커> <effort>`로 세션 한정만 바꾼다. Codex에서 enter는 전역 `~/.codex/config.toml`을 바꿔 다른 워크스페이스(zzik)에 영향을 주므로 금지하고 `s`를 쓴다. 재시작하면 원복되므로 시작 effort는 열 때 인자로 준다. opencode는 `--model`이 필수이고, `--provider '<문구>'`로 변경 뒤 공급자가 같은지 확인한다.
- TUI 조작은 단계마다 `herdr pane read --source visible`에서 기대 문자열이 보일 때까지 폴링한 뒤 다음 키를 보낸다. `send-text` 직후 `send-keys enter`를 붙여 보내지 않는다.
- 회귀 테스트: `bash tests/scripts/herdr/run.sh`. 가짜 실행 파일로 실제 Herdr 패널을 건드리지 않는다.

## pnpm
- store 경로: `/Users/young-mini/Library/pnpm/store`. 샌드박스(Codex)에서 홈 store 접근이 실패하면 pnpm이 저장소 안에 `.pnpm-store/`를 만든다. 워커 지시에 `pnpm --config.store-dir=/Users/young-mini/Library/pnpm/store <명령>`을 명시한다(`--store-dir`는 거부됨). `PNPM_STORE_DIR`로 기본 store 경로를 덮어쓸 수 있다(릴리스·배포). `.pnpm-store`는 `.gitignore`에 있고 `release.mjs`는 존재 시 실패한다.
- pnpm 10+는 의존성 빌드 스크립트를 차단한다. `ERR_PNPM_IGNORED_BUILDS`가 나면 `pnpm-workspace.yaml`의 `allowBuilds`에 패키지를 추가한다(현재 esbuild, workerd).

## 릴리스
- **버전 규칙**. `<책 장>.<기능 단계>.<수정>`을 사용한다. 메이저는 3장 채팅(/chat), 4장 Queens(/queens), 5장 어드벤처(/adventure), 6장 회화(/talk), 7장 리서치(/research)에 대응한다. 마이너는 장 안의 기능 단계이며 0부터 시작한다. 수정·보강·문서·하네스만 바꾸면 현재 장의 패치를 올린다. 새 장은 `<장>.0.0`으로 시작한다.
- 과거 태그는 이력으로 보존한다. 6장 회화는 `5.2.0`~`5.2.2`, 7장 리서치는 `5.3.0`~`5.3.2`로도 릴리스됐다. `5.3.2`와 `7.0.0`은 같은 커밋을 가리킨다. 기존 원격 태그 삭제 여부는 사용자 결정 사항이다.
- `pnpm release <버전>`은 릴리스 형식의 **로컬 태그** 중 가장 높은 메이저보다 낮은 버전을 거부한다. 새 메이저에는 `--chapter <N>`을 넘기며 N은 메이저와 같아야 한다. 총괄은 태그를 만들기 전에 적용할 버전을 사용자에게 한 줄로 알리고 확인한다.
- 기본은 빠른 경로다. `pnpm test`는 `tests/**/*.test.ts`만 실행한다. 느리거나 복잡한 검증은 `*.slow.ts`로 분리하며, `pnpm test:slow`·`pnpm smoke <url> --llm`·`bash tests/scripts/herdr/run.sh`·실모델 검증은 요청 시에만 실행한다. 기본 CI·릴리스·배포에 이 특수 검증을 추가하지 않는다.
- `pnpm release <버전>`(`scripts/release.mjs`). 작업 트리 확인 → 빠른 test·typecheck·build → 태그 중복 확인 → HEAD에 태그 → `git push --atomic origin <branch> <버전>` → `git ls-remote --tags`로 확인. 커밋은 스크립트가 하지 않고, 미추적 `docs/retro/`만 경고로 허용한다.
- 새 라우트·기능의 OG와 README는 같은 메이저의 다음 패치까지 갱신한다. `scripts/og.json`에 항목을 추가하고 `pnpm og`로 `public/og-image.png`와 `index.html`의 OG 구간을 갱신한다. README 기능표·아키텍처 그림에도 라우트를 추가한다. `og:check`는 등록된 구성과 산출물의 불일치를 막는다. 카카오 공유 캐시를 초기화하고 Pillow는 시스템 또는 venv에 설치한다. [카카오 공유 캐시 도구](https://developers.kakao.com/tool/clear/og)
- 계획 확인은 `node scripts/release.mjs <버전> --dry-run`을 사용한다. 새 메이저를 계획에 넣을 때도 `--chapter <N>`을 지정한다.
- 릴리스 직후 소스를 바꾸지 않고 배포할 때는 `pnpm run deploy --skip-build`로 방금 만든 `dist`를 재사용한다. `dist/index.html`이 없으면 실패한다. 독립 배포는 기본 build를 한 번 수행한다.
- 여러 워커가 같은 트리에서 경로별 커밋을 했으면 릴리스 전에 `pnpm verify:head [ref]`로 커밋된 HEAD만 검증한다(임시 worktree에서 test·typecheck·build 후 정리, `--dry-run`·`--keep`). node_modules는 원본을 심링크로 공유해 vite가 임시 파일을 쓸 수 있고, 다른 ref의 lockfile이 다르면 의존성 검증은 아니다. 정리 실패 시 출력되는 RECOVERY 명령을 따른다.
- GitHub 이슈는 커밋 메시지에 `fixes #N` 대신 `refs #N`을 쓴다. 배포·운영 확인 후 총괄이 결과 댓글과 함께 닫는다(2026-11-17, `fixes`가 배포 전에 이슈를 닫은 일).
- 중간에 끼어든 작은 요청은 별도 버전으로 먼저 커밋·태그해 순서를 유지한다.

## Cloudflare Workers 배포
- **Workers 런타임 검증**. Node 테스트에서 통과한 fetch 옵션도 workerd에서 실패할 수 있다. `redirect: 'error'`는 요청 전 TypeError를 내서 5.3.0·5.3.1의 리서치 검색을 막았다. `pnpm test`의 `tests/arch/workers-fetch-options.test.ts`가 `src/infra` 옵션 리터럴을 검사한다. `src/infra`의 Workers 실행 경로, `wrangler.jsonc` 또는 호환 날짜를 바꾸면 대상 경로를 로컬 workerd로 검증하고 Discord 검증란에 남긴다. 공통 어댑터용 workerd 회귀 테스트는 별도 작업이다. [옵션 호환 표](../providers.md#workers-fetch-호환-표)
- **운영 Research 확인**. 리서치 공급자나 인프라를 바꾼 배포 후 총괄이 사용자에게 운영 화면에서 주제 한 건을 실행해 달라고 요청한다. 결과의 `steps`에서 `search_web` 성공 여부를 기록한다. 비용과 소요 시간을 고려해 기본 GET 스모크와 별도로 수행한다.
- **커스텀 도메인**. 운영 주소는 `aips.qus0in.dev`와 workers.dev 둘이다. `wrangler.jsonc`에 `routes`를 두면 workers.dev가 기본 비활성이 되므로 `workers_dev: true`를 함께 적는다. 2026-11-19 9.8.0에서 workers.dev 주소가 1042 오류를 냈다. 배포 후 두 주소를 모두 확인한다(`pnpm smoke`와 `pnpm smoke https://aips.qus0in.dev`).
- **배포 설정 변경**. `routes`·`triggers`·바인딩처럼 `wrangler deploy` 출력이 달라지는 설정을 바꾸면 배포 전에 `tests/scripts/release-tools.test.ts`에 새 출력 예시를 추가한다. 2026-11-19 custom domain 출력을 파서가 읽지 못했다.
- 배포는 총괄(`ps-opus`)만 한다. 워커는 배포하지 않는다.
- 릴리스와 이어 하는 빠른 경로: 리뷰 게이트 → `pnpm release <버전>`(test·typecheck·build·태그 푸시) → `pnpm run deploy --skip-build` → workers.dev URL과 GET 스모크 확인 → Discord 보고. 별도 사전 build를 반복하지 않는다. 이미 검증·빌드를 마친 뒤 배포하는 다른 절차에서도 `--skip-build`를 사용하되, 빌드 이후 소스를 바꾸었다면 다시 빌드한다.
- `pnpm run deploy`(`scripts/deploy.mjs`)가 build 1회 → 앱 키 secret 동기화 → `wrangler deploy` → URL·Version 파싱 → GET 스모크까지 이어 한다. 수동 `wrangler secret bulk`는 쓰지 않는다. `--skip-build`·`--skip-secrets`·`--dry-run` 지원. 첫 배포(Worker 미존재)로 `wrangler secret list`가 실패하면 원격 키 비교만 건너뛴다.
- secret은 `.env`의 앱 키만 올린다: `OPENAI_API_KEY`·`OPENAI_MODEL`·`OPENAI_TOOL_MODE`·`OWM_API_KEY`, 있으면 `OPENAI_BASE_URL`·`LOG_LEVEL`. 검색 키는 `BRAVE-SEARCH-API-KEY` → `BRAVE_SEARCH_API_KEY`, `X-NCP-APIGW-API-KEY-ID` → `NCP_API_KEY_ID`, `X-NCP-APIGW-API-KEY` → `NCP_API_KEY`로 매핑한다. `DISCORD_WEBHOOK_URL`은 올리지 않고, 값은 출력하지 않는다. JSON은 stdin으로 전달하며 임시 secret 파일은 만들지 않는다.
- 기본 스모크(`pnpm smoke <url>`, URL 생략 시 운영 URL)는 `/`·`/chat`과 `scripts/og.json` features의 `route`를 중복 없이 GET 200으로 확인한다. `--assets`는 `git ls-files public/`의 추적 파일 전체를 운영과 바이트 비교한다(PASS/MISMATCH/HTTP/ERROR, 해시·본문 미출력, 비PASS 자산만 5초 뒤 1회 재시도). deploy는 배포 후 자동으로 `--assets`를 붙인다. 미추적 public 파일은 제외되므로 커밋 후 배포한다. 요청받았을 때만 `pnpm smoke <url> --llm`으로 실제 LLM POST를 추가한다(비용·로그 발생). 응답 본문은 길이·존재 여부만 출력한다.
- 공개 URL에 인증은 없다. `/api/talk/*` 네 경로는 Workers Rate Limiting 바인딩으로 제한한다: `TALK_AUDIO_LIMIT`은 speech·transcribe 합산 IP당 10회/60초(namespace `2061088357`), `TALK_TURN_LIMIT`은 turn·report 합산 20회/60초(namespace `3990254962`). 키는 `CF-Connecting-IP`(없으면 `anon`), 초과 시 429·`Retry-After: 60`. `RESEARCH_LIMIT`은 `/api/research`를 IP당 3회/60초로 제한한다. 운영에서 이 바인딩이 없거나 실패하면 503을 돌려준다. Vite 개발 환경에는 바인딩이 없다. 이 한도는 위치별 근사치이며 전 세계 합산의 엄격한 상한이 아니다. [Cloudflare 정본](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
- TTS R2: 바인딩 `TALK_AUDIO` → 버킷 `ai-ps-talk-audio`. 총괄이 버킷 생성과 **30일 만료 규칙** 설정을 완료했다. 캐시는 모델·음성·프롬프트 버전·정규화 텍스트의 해시 키로 저장한다. 음성 요청의 응답 헤더는 `Cache-Control: no-store`, `X-Talk-Cache: hit|miss`이며 브라우저 재생은 objectURL 메모리 캐시를 사용한다.
- Research KV: 바인딩 `RESEARCH_CACHE` → 총괄이 `wrangler kv namespace create`로 생성한 id `f63cfb7d95aa471ab33d3d963bcb0fa3`. 검색 결과는 TTL 6시간(`rs/v1/<sha256>`), 페이지 본문은 TTL 24시간(`rp/v1/<sha256>`)으로 저장한다. 총괄이 배포 후 `/research` 1회 실행하고 `wrangler kv key list --binding RESEARCH_CACHE`로 키가 쌓이는지 확인한다.
- TTS 입력 상한은 **200자**(`MAX_TTS_TEXT_LENGTH`), 튜터 reply는 약 2문장·120자 이내로 지시한다. 391자 실측이 1024토큰에서 잘렸고 출력 240자만으로 PCM 약 1.81MB에 도달했으므로, 출력 한도는 2048토큰으로 올리고 입력을 200자로 낮춰 WAV 2MiB 상한에 여유를 둔다(2026-11-17).
- `/talk` 변경 배포 후 총괄이 명시적으로 실행하는 유료 스모크: 같은 짧은 일본어 문장으로 `POST /api/talk/speech`를 두 번 보내 **miss → hit 1쌍**과 WAV 정상 여부를 확인한다. 첫 요청만 TTS 비용이 든다. 문장을 바꾸거나 miss를 반복하지 않으며, 기존 R2 객체로 첫 요청부터 hit이면 이를 기록한다. 기본 GET 스모크에는 추가하지 않는다. 로그/보고는 cache·시간·바이트 수만 남기고 키·음성·받아쓴 원문은 출력하지 않는다.

### 배포 전 리뷰 게이트
- 공개 노출이 생기거나 늘어나는 변경(새 라우트·로그 필드·오류 응답·공급자 연결·비밀값 취급)은 구현자와 모델 계열이 다른 리뷰어(짝은 `agents.md` 교차 리뷰) 결과를 받은 뒤 배포한다.
- 사용자가 생략을 지시하면 "리뷰 없이 배포하면 공개 응답·로그 노출 결함이 그대로 나갑니다"를 한 줄 고지하고 지시대로 진행한다. Discord 검증란에 리뷰 생략 사실을 적는다. 미반영 blocker가 있으면 커밋 메시지에도 ID와 미반영 사실을 적고 다음 패치의 첫 항목으로 올린다.

## 브라우저 확인
- Chrome이 둘 이상 연결되면 세션 시작 시 `list_connected_browsers`로 확인해 하나를 고른다. 스크린샷을 생략했으면 보고의 "검증"에 "시각 확인 미완"으로 적는다.
