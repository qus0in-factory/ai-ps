#!/usr/bin/env bash
# 항목 1(재수정): --provider 생략 시 공급자 기준은 메뉴 커서가 아니라 "변경 전 상태줄"이다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

# n=0(아직 /models 제출 전)에는 상태줄 화면을, 이후에는 메뉴 화면을 보여 준다.
fake_herdr '
printf "%s\n" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "agent get") printf "{\"result\":{\"agent\":{\"agent\":\"opencode\",\"pane_id\":\"fake:p2\"}}}\n" ;;
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
    if [ "$n" -ge 2 ]; then cat "$FAKE_DIR/variant"; else cat "$FAKE_DIR/models"; fi ;;
  *) printf "{}\n" ;;
esac'
export FAKE_LOG="$WORK/calls" FAKE_DIR="$WORK"

run_case() { # <before> <models> <variant> -> exit code in $?
  printf '%s' "$1" > "$WORK/before"
  printf '%s' "$2" > "$WORK/models"
  printf '%s' "$3" > "$WORK/variant"
  rm -f "$WORK/enters" "$WORK/echo"
  : > "$FAKE_LOG"
  set +e
  run_ai_ps herdr-set-effort.sh ps-x high --agent opencode --model deepseek-v4.1-flash >"$WORK/out" 2>&1
  return $?
}

# 1) 상태줄은 Ollama Cloud, 메뉴 커서는 OpenCode Go → --provider 없이도 중단해야 한다
set +e
run_case 'DeepSeek V4.1 Flash Ollama Cloud high
' 'Select model
> DeepSeek V4.1 Flash  OpenCode Go
  DeepSeek V4.1 Flash  Ollama Cloud
' 'Select variant
> medium
  high
'
s=$?
set -e
ok_if "--provider 없이 상태줄 공급자와 커서가 다르면 exit≠0" [ "$s" -ne 0 ]
enters=$(grep -c "send-keys fake:p2 enter" "$FAKE_LOG" || true)
ok_if "모델 확정 Enter 를 보내지 않는다(제출 1회 이하)" [ "$enters" -le 1 ]

# 2) 상태줄과 커서가 같은 공급자면 진행하고, 적용 후에도 같은 공급자여야 한다
set +e
run_case 'DeepSeek V4.1 Flash Ollama Cloud high
' 'Select model
> DeepSeek V4.1 Flash  Ollama Cloud
  DeepSeek V4.1 Flash  OpenCode Go
' 'Select variant
> medium
  high
  max
DeepSeek V4.1 Flash Ollama Cloud high
'
s=$?
set -e
ok_if "상태줄·커서 공급자가 같으면 적용된다" [ "$s" = 0 ]

# 3) 적용 후 공급자가 바뀐 상태줄이면 exit 1
set +e
run_case 'DeepSeek V4.1 Flash Ollama Cloud high
' 'Select model
> DeepSeek V4.1 Flash  Ollama Cloud
' 'Select variant
> medium
  high
DeepSeek V4.1 Flash OpenCode Go high
'
s=$?
set -e
ok_if "적용 후 공급자가 달라지면 exit≠0" [ "$s" -ne 0 ]

# 4) 상태줄에서 공급자를 읽지 못하면 --provider 를 요구하며 중단
set +e
run_case 'DeepSeek V4.1 Flash · high
' 'Select model
> DeepSeek V4.1 Flash
' 'Select variant
> medium
  high
'
s=$?
set -e
ok_if "공급자를 읽지 못하면 exit≠0" [ "$s" -ne 0 ]
ok_if "공급자를 읽지 못했다고 안내한다" grep -q -- "--provider" "$WORK/out"

report
