#!/usr/bin/env bash
# 회귀: Codex effort 전체 흐름. helper 함수 누락(herdr_menu_index) 같은 오류를 잡는다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

# 1) helper 에 herdr_menu_index 가 실제로 있어야 한다(정의 삭제 회귀 방지).
set +e
PATH="$WORK/bin:$PATH" bash -c '. "$1"; type herdr_menu_index >/dev/null' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "herdr_menu_index 가 helper 에 정의되어 있다" [ "$s" = 0 ]

# 2) 완전 일치 유지: xhigh 는 high 로 잡히지 않는다.
out=$(PATH="$WORK/bin:$PATH" bash -c '. "$1"; herdr_menu_index "  > xhigh" minimal low medium high xhigh' _ "$ROOT/scripts/lib/herdr.sh")
ok_if "menu index 완전 일치(xhigh=4)" [ "$out" = 4 ]

# 3) Codex 전체 흐름: /model → 모델 메뉴 확인 → 레벨 메뉴 확인 → Down → s → 상태줄 확인
fake_herdr '
printf "%s\n" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "agent get") printf "{\"result\":{\"agent\":{\"agent\":\"codex\",\"pane_id\":\"fake:p1\"}}}\n" ;;
  "pane send-text") printf "%s" "$4" > "$FAKE_DIR/echo"; printf "{}\n" ;;
  "pane send-keys")
    if [ "$4" = "enter" ]; then
      n=$(cat "$FAKE_DIR/enters" 2>/dev/null || echo 0)
      echo $((n + 1)) > "$FAKE_DIR/enters"
    fi
    printf "{}\n" ;;
  "pane read")
    cat "$FAKE_DIR/echo" 2>/dev/null; printf "\n"
    n=$(cat "$FAKE_DIR/enters" 2>/dev/null || echo 0)
    if grep -q "fake:p1 s$" "$FAKE_LOG" 2>/dev/null; then
      printf "Select Reasoning Level\n  low\n  medium\n  high\n  xhigh\nGPT-6.1-Sol · high\n"
    elif [ "$n" -ge 2 ]; then
      printf "Select Reasoning Level\n  low\n> medium\n  high\n  xhigh\nGPT-6.1-Sol · medium\n"
    elif [ "$n" -ge 1 ]; then
      printf "Select Model\n> GPT-6.1-Sol\n  GPT-6-Astra\n"
    else
      printf "GPT-6.1-Sol · medium\n"
    fi ;;
  *) printf "{}\n" ;;
esac'
export FAKE_LOG="$WORK/calls" FAKE_DIR="$WORK"
: > "$FAKE_LOG"
rm -f "$FAKE_DIR/enters"

set +e
run_ai_ps herdr-set-effort.sh ps-fake high --agent codex >"$WORK/out" 2>&1
s=$?
set -e
sed -n '1,40p' "$WORK/out" >&2
ok_if "Codex effort 흐름이 끝까지 진행된다" [ "$s" = 0 ]

# 마지막 키는 s 이고, 그 앞에 Down 1회(medium→high), enter 2회(제출·모델 확정)
keys=$(grep "pane send-keys fake:p1" "$FAKE_LOG" | sed 's/.*fake:p1 //' | tr '\n' ' ')
ok_if "키 순서가 enter·enter·Down·s 다(실제: $keys)" [ "$keys" = "enter enter Down s " ]

report
