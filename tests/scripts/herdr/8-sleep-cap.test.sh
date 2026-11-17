#!/usr/bin/env bash
# 항목 2: sleep 은 min(폴링 간격, 남은 deadline)을 넘지 않는다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

sleep_for_case() { # <poll> <elapsed> <timeout>
  PATH="$WORK/bin:$PATH" HERDR_POLL_SECONDS="$1" bash -c \
    '. "$1"; herdr_sleep_seconds "$2" "$3"' _ "$ROOT/scripts/lib/herdr.sh" "$2" "$3"
}

out=$(sleep_for_case 60 18 20)
ok_if "남은 2초면 60초 대신 2초만 잔다($out)" [ "$out" = "2.00" ]

out=$(sleep_for_case 0.5 0 20)
ok_if "여유가 있으면 폴링 간격을 쓴다($out)" [ "$out" = "0.50" ]

out=$(sleep_for_case 60 25 20)
ok_if "이미 지난 경우 최소 1초로 제한한다($out)" [ "$out" = "1.00" ]

# 폴링 간격 검증은 그대로 유지(0·. 거부)
set +e; check_env() { env "$@" PATH="$WORK/bin:$PATH" bash -c '. "$1"' _ "$ROOT/scripts/lib/herdr.sh" >/dev/null 2>&1; }
check_env HERDR_POLL_SECONDS=0; s=$?; set -e
ok_if "HERDR_POLL_SECONDS=0 은 여전히 거부" [ "$s" -ne 0 ]

report
