#!/usr/bin/env bash
# 회귀: OpenCode 2.3.2 화면에서 상태줄은 마지막 줄(버전 번호)이 아니라 'Build' 포함 줄이다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fake_herdr '
case "$1 $2" in
  "pane read") printf "%s\n" "$FAKE_SCREEN" ;;
  *) printf "{}\n" ;;
esac'
export FAKE_SCREEN='OpenCode v2.3.2
┃  Build · GLM-5.3 OpenCode Go · high
2.3.2'

# 1) herdr_last_line(herdr_status_line)이 Build 포함 줄을 고른다
out=$(PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_last_line "$2"' _ "$ROOT/scripts/lib/herdr.sh" "$FAKE_SCREEN")
ok_if "상태줄이 Build 줄이다" [ "$out" = "┃  Build · GLM-5.3 OpenCode Go · high" ]

# 2) verify_text: 모델명(대소문자 무관) 통과
set +e
PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_verify_text fake:p1 "glm-5.3" 1' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "verify_text glm-5.3 통과" [ "$s" = 0 ]

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