#!/usr/bin/env bash
# tests/scripts/herdr 공통 하네스. 실제 Herdr 대신 가짜 실행 파일을 PATH 앞에 둔다.
# 사용: . "$(dirname "$0")/lib.sh"  (각 *.test.sh 첫 줄들에서)
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/herdr-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

ok() { # <설명> <0|그 외>
  if [ "$2" = 0 ]; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1" >&2
  fi
}

# 조건이 실패해도 set -e 로 중단되지 않게 감싼다(테스트 실패를 모아서 보고).
ok_if() { # <설명> <명령...>
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then ok "$desc" 0; else ok "$desc" 1; fi
}

# 가짜 herdr: 본문을 그대로 실행 파일로 만든다.
fake_herdr() { # <본문>
  mkdir -p "$WORK/bin"
  printf '#!/usr/bin/env bash\n' > "$WORK/bin/herdr"
  printf '%s\n' "$1" >> "$WORK/bin/herdr"
  chmod +x "$WORK/bin/herdr"
}

# 스크립트 실행: PATH/HERDR_* 를 가짜 환경으로 고정한다.
run_ai_ps() { # <스크립트> <인자...>
  PATH="$WORK/bin:$PATH" \
  HERDR_ENV=1 \
  HERDR_WORKSPACE_ID=fake-ws \
  HERDR_STEP_TIMEOUT=2 \
  HERDR_VERIFY_TIMEOUT=2 \
  HERDR_READ_TIMEOUT=2 \
  HERDR_VARIANT_TIMEOUT=2 \
  HERDR_POLL_SECONDS=0.05 \
  "$ROOT/scripts/$1" "${@:2}"
}

report() {
  printf '%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
  [ "$FAIL" -eq 0 ]
}
