#!/usr/bin/env bash
# 항목 2: effort 는 상태줄 마지막 줄의 토큰 완전 일치로 확인한다(xhigh ≠ high).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fake_herdr '
case "$1 $2" in
  "pane read") printf "%s\n" "$FAKE_SCREEN" ;;
  *) printf "{}\n" ;;
esac'
export FAKE_SCREEN=""

herdr_verify_effort() {
  PATH="$WORK/bin:$PATH" HERDR_ENV=1 bash -c '. "$1"; herdr_verify_effort "$2" "$3" 1' _ "$ROOT/scripts/lib/herdr.sh" fake:p1 "$1"
}

# 1) 상태줄이 xhigh 인데 high 로 통과하면 안 된다
export FAKE_SCREEN='GPT-6.1-Sol · xhigh'
set +e; herdr_verify_effort high; s1=$?; set -e
ok_if "xhigh 상태줄에서 high 는 불일치" [ "$s1" -ne 0 ]

# 2) xhigh 는 통과
set +e; herdr_verify_effort xhigh; s2=$?; set -e
ok_if "xhigh 상태줄에서 xhigh 는 일치" [ "$s2" = 0 ]

# 3) 위쪽 echo/메뉴 줄에 high 가 있어도 마지막 줄 기준이면 통과하지 않는다
export FAKE_SCREEN='> high
Select Reasoning Level
  low
  medium
  high
GPT-6.1-Sol · medium'
set +e; herdr_verify_effort high; s3=$?; set -e
ok_if "메뉴 잔상·echo 는 근거로 쓰지 않는다" [ "$s3" -ne 0 ]

# 4) 구분자(·, |, 괄호) 뒤 토큰도 인식
export FAKE_SCREEN='OpenCode · DeepSeek V4.1 (high)'
set +e; herdr_verify_effort high; s4=$?; set -e
ok_if "·/괄호 뒤 effort 토큰을 인식" [ "$s4" = 0 ]

report
