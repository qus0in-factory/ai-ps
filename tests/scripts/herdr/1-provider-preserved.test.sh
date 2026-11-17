#!/usr/bin/env bash
# 항목 1: effort 변경 후 모델명뿐 아니라 공급자도 그대로인지 확인한다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

# n=0(아직 /models 제출 전)에는 변경 전 상태줄을, 이후에는 메뉴 화면을 보여 준다.
fake_herdr '
printf "%s\n" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "agent get") printf "{\"result\":{\"agent\":{\"agent\":\"opencode\",\"pane_id\":\"fake:p1\"}}}\n" ;;
  "pane send-text") printf "%s" "$4" > "$FAKE_DIR/echo"; printf "{}\n" ;;
  "pane send-keys")
    if [ "$4" = "enter" ]; then
      n=$(cat "$FAKE_DIR/enters" 2>/dev/null || echo 0)
      echo $((n + 1)) > "$FAKE_DIR/enters"
    fi
    printf "{}\n" ;;
  "pane read")
    n=$(cat "$FAKE_DIR/enters" 2>/dev/null || echo 0)
    if [ "$n" = 0 ]; then
      cat "$FAKE_DIR/before" 2>/dev/null
      cat "$FAKE_DIR/echo" 2>/dev/null
      exit 0
    fi
    cat "$FAKE_DIR/echo" 2>/dev/null; printf "\n"
    if [ "$n" -ge 2 ]; then cat "$FAKE_DIR/variant.txt"; else cat "$FAKE_DIR/models.txt"; fi ;;
  *) printf "{}\n" ;;
esac'
export FAKE_LOG="$WORK/calls" FAKE_DIR="$WORK"

reset_state() {
  : > "$FAKE_LOG"
  rm -f "$FAKE_DIR/enters" "$FAKE_DIR/echo"
}

# 1) 커서가 다른 공급자(OpenCode Go)인데 시작 상태줄은 Ollama Cloud → Enter 전에 중단
reset_state
printf 'DeepSeek V4.1 Flash Ollama Cloud high\n' > "$WORK/before"
printf 'Select model\n> DeepSeek V4.1 Flash  OpenCode Go\n  DeepSeek V4.1 Flash  Ollama Cloud\n' > "$WORK/models.txt"
printf 'Select variant\n> medium\n  high\n' > "$WORK/variant.txt"
set +e
run_ai_ps herdr-set-effort.sh ps-x high --agent opencode --model deepseek-v4.1-flash >"$WORK/out1" 2>&1
status=$?
set -e
ok_if "다른 공급자 커서면 exit≠0" test "$status" -ne 0
ok_if "공급자 불일치를 사유로 알린다" grep -q "공급자" "$WORK/out1"
enters=$(grep -c "send-keys fake:p1 enter" "$FAKE_LOG" || true)
ok_if "모델 확정 Enter 를 보내지 않는다" test "$enters" -le 1

# 2) 커서와 시작 상태줄이 같은 공급자 → 적용되고, 적용 후 상태줄도 같은 공급자
reset_state
printf 'DeepSeek V4.1 Flash Ollama Cloud high\n' > "$WORK/before"
printf 'Select model\n> DeepSeek V4.1 Flash  Ollama Cloud\n  DeepSeek V4.1 Flash  OpenCode Go\n' > "$WORK/models.txt"
printf 'Select variant\n> medium\n  high\n  max\nDeepSeek V4.1 Flash Ollama Cloud high\n' > "$WORK/variant.txt"
set +e
run_ai_ps herdr-set-effort.sh ps-x high --agent opencode --model deepseek-v4.1-flash >"$WORK/out2" 2>&1
status=$?
set -e
ok_if "같은 공급자면 적용된다" test "$status" -eq 0

# 3) 적용 후 상태줄의 공급자가 바뀌면 exit 1
reset_state
printf 'DeepSeek V4.1 Flash Ollama Cloud high\n' > "$WORK/before"
printf 'Select model\n> DeepSeek V4.1 Flash  Ollama Cloud\n' > "$WORK/models.txt"
printf 'Select variant\n> medium\n  high\nDeepSeek V4.1 Flash OpenCode Go high\n' > "$WORK/variant.txt"
set +e
run_ai_ps herdr-set-effort.sh ps-x high --agent opencode --model deepseek-v4.1-flash >"$WORK/out3" 2>&1
status=$?
set -e
ok_if "적용 후 공급자가 달라지면 exit≠0" test "$status" -ne 0

report
