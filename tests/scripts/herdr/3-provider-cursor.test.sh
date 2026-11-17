#!/usr/bin/env bash
# 항목 3: 공급자 선택은 표기 정규화 + 현재 커서 기준 상대 이동 + Enter 전 재확인.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fake_herdr 'printf "{}\n"'

delta() { # <screen> <모델 표시어> <공급자> [title]
  PATH="$WORK/bin:$PATH" bash -c '. "$1"; herdr_row_delta "$2" "$3" "$4" "$5"' _ \
    "$ROOT/scripts/lib/herdr.sh" "$1" "$2" "$3" "${4:-}"
}

screen=$'Search: deepseek-v4.1-flash\nSelect model\n> DeepSeek V4.1 Flash  OpenCode Go\n  DeepSeek V4.1 Flash  Ollama Cloud'
# 1) slug 를 표기와 정규화 비교해 공급자 항목을 찾는다(이전: -1)
out=$(delta "$screen" deepseek-v4.1-flash "Ollama Cloud" "Select [Mm]odel")
ok_if "slug→표기 정규화로 공급자 항목을 찾는다(delta=1)" [ "$out" = 1 ]

# 2) 이미 목표 항목에 커서가 있으면 이동량 0
screen2=$'Select model\n  DeepSeek V4.1 Flash  OpenCode Go\n> DeepSeek V4.1 Flash  Ollama Cloud'
out=$(delta "$screen2" deepseek-v4.1-flash "Ollama Cloud" "Select [Mm]odel")
ok_if "이미 커서가 목표면 이동하지 않는다(delta=0)" [ "$out" = 0 ]

# 3) 커서가 아래에 있고 목표가 위면 음수(Up)
screen3=$'Select model\n> DeepSeek V4.1 Flash  Ollama Cloud\n  DeepSeek V4.1 Flash  OpenCode Go'
out=$(delta "$screen3" deepseek-v4.1-flash "OpenCode Go" "Select [Mm]odel")
ok_if "아래 항목으로는 Down(+1)" [ "$out" = 1 ]

# 4) 표기가 전혀 다르면 -1 이 아니라 '찾지 못함'(exit≠0)
screen4=$'Select model\n> Unknown Model  Other\n'
set +e; delta "$screen4" no-such-model "Ollama Cloud" "Select [Mm]odel" >/dev/null; s=$?; set -e
ok_if "목표를 못 찾으면 실패로 알린다" [ "$s" -ne 0 ]

# 5) Enter 직전 재확인 함수: 커서가 목표와 다르면 실패, 같으면 성공
fake_herdr 'case "$1 $2" in "pane read") printf "%s\n" "$FAKE_SCREEN" ;; *) printf "{}\n" ;; esac'
export FAKE_SCREEN='Select model
  DeepSeek V4.1 Flash  Ollama Cloud
> Some Other Model  OpenCode Go'
set +e
PATH="$WORK/bin:$PATH" bash -c '. "$1"; herdr_cursor_matches fake:p1 deepseek-v4.1-flash "Ollama Cloud" "Select [Mm]odel"' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "커서가 목표가 아니면 재확인이 실패한다" [ "$s" -ne 0 ]

export FAKE_SCREEN='Select model
  DeepSeek V4.1 Flash  OpenCode Go
> DeepSeek V4.1 Flash  Ollama Cloud'
set +e
PATH="$WORK/bin:$PATH" bash -c '. "$1"; herdr_cursor_matches fake:p1 deepseek-v4.1-flash "Ollama Cloud" "Select [Mm]odel"' _ "$ROOT/scripts/lib/herdr.sh"
s=$?
set -e
ok_if "커서가 목표면 재확인이 통과한다" [ "$s" = 0 ]

# 6) 통합: 목록에 해당 공급자가 없으면 Enter 없이 중단
fake_herdr '
printf "%s\n" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "tab create") printf "{\"result\":{\"root_pane\":{\"pane_id\":\"fake:p3\"},\"tab\":{\"tab_id\":\"fake:t3\"}}}\n" ;;
  "pane send-text") printf "%s" "$4" > "$FAKE_DIR/echo"; printf "{}\n" ;;
  "pane send-keys") printf "{}\n" ;;
  "pane read") cat "$FAKE_DIR/echo" 2>/dev/null; printf "\n"; cat "$FAKE_DIR/screen" ;;
  *) printf "{}\n" ;;
esac'
export FAKE_LOG="$WORK/calls2" FAKE_DIR="$WORK"
printf 'Select model\n> DeepSeek V4.1 Flash  OpenCode Go\n  DeepSeek V4.1 Flash  Ollama Cloud\n' > "$WORK/screen"
: > "$FAKE_LOG"
set +e
run_ai_ps herdr-open-worker.sh ps-x opencode deepseek-v4.1-flash high --provider 'Nope Cloud' --search deepseek >"$WORK/out" 2>&1
s=$?
set -e
ok_if "공급자 항목이 없으면 exit≠0" [ "$s" -ne 0 ]
ok_if "항목을 못 찾았다고 알린다" grep -q "찾지 못했습니다" "$WORK/out"
enters=$(grep -c "send-keys fake:p3 enter" "$FAKE_LOG" || true)
ok_if "모델 확정 Enter 를 보내지 않는다(제출 2회뿐)" [ "$enters" = 2 ]

report
