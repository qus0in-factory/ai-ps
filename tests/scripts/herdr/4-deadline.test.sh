#!/usr/bin/env bash
# 항목 4: timeout 정수 검증(10진 강제)과 화면 읽기 hard deadline(SIGTERM→SIGKILL).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

# 1) SIGTERM 을 무시하는 가짜 herdr 라도 deadline 안에 끝나야 한다.
fake_herdr 'trap "" TERM; sleep 30'
start=$(date +%s)
set +e
PATH="$WORK/bin:$PATH" HERDR_READ_TIMEOUT=1 bash -c '
  . "$1"
  herdr_visible fake:p1
' _ "$ROOT/scripts/lib/herdr.sh" >/dev/null 2>&1
status=$?
set -e
end=$(date +%s)
elapsed=$((end - start))
ok_if "SIGTERM 무시 프로세스도 실패로 끝난다" [ "$status" -ne 0 ]
ok_if "hard deadline 안에 반환한다(${elapsed}s)" [ "$elapsed" -le 5 ]

# 2) timeout 입력 검증: 비정수·0·8진수 표기·잘못된 간격
check_env() { # <환경할당...>
  env "$@" PATH="$WORK/bin:$PATH" bash -c '. "$1"' _ "$ROOT/scripts/lib/herdr.sh" >/dev/null 2>&1
}
set +e; check_env HERDR_VARIANT_TIMEOUT=oops; s=$?; set -e
ok_if "HERDR_VARIANT_TIMEOUT=oops 거부" [ "$s" -ne 0 ]
set +e; check_env HERDR_READ_TIMEOUT=0; s=$?; set -e
ok_if "HERDR_READ_TIMEOUT=0 거부" [ "$s" -ne 0 ]
set +e; check_env HERDR_POLL_SECONDS=0; s=$?; set -e
ok_if "HERDR_POLL_SECONDS=0 거부" [ "$s" -ne 0 ]
set +e; check_env HERDR_POLL_SECONDS=.; s=$?; set -e
ok_if "HERDR_POLL_SECONDS=. 거부" [ "$s" -ne 0 ]

# 3) 08 은 8진수로 해석하지 않고 10진 8로 받아들인다(예전: $((08*10)) 오류)
set +e
PATH="$WORK/bin:$PATH" HERDR_READ_TIMEOUT=08 bash -c '
  . "$1"
  [ "$HERDR_READ_TIMEOUT" = 8 ]
' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "HERDR_READ_TIMEOUT=08 을 10진 8로 정규화" [ "$s" = 0 ]

report
