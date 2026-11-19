#!/usr/bin/env bash
# 회귀: Codex 0.170 화면에서 상태줄은 마지막 줄(agents 힌트)이 아니라 모델명 포함 줄이다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fake_herdr '
case "$1 $2" in
  "pane read") printf "%s\n" "$FAKE_SCREEN" ;;
  *) printf "{}\n" ;;
esac'
export FAKE_SCREEN='Codex
GPT-6.1-Sol high fast · ~/Workspace/ai-ps
← for agents  ⚠ 1 warning · f2 to view'

# 1) herdr_last_line이 모델명 포함 줄을 고른다
out=$(PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_last_line "$2"' _ "$ROOT/scripts/lib/herdr.sh" "$FAKE_SCREEN")
ok_if "상태줄이 모델명 줄이다" [ "$out" = "GPT-6.1-Sol high fast · ~/Workspace/ai-ps" ]

# 2) verify_text: slug(소문자)로도 통과(대소문자 무시)
set +e
PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_verify_text fake:p1 "gpt-6.1-sol" 1' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "verify_text gpt-6.1-sol 통과" [ "$s" = 0 ]

# 3) verify_effort: high 통과, medium 불일치
set +e
PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_verify_effort fake:p1 "high" 1' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "verify_effort high 통과" [ "$s" = 0 ]

set +e
PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_verify_effort fake:p1 "medium" 1' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "verify_effort medium 불일치" [ "$s" -ne 0 ]

report