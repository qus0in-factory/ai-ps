#!/usr/bin/env bash
# 회귀: --keep-model 은 opencode 의 /models 메뉴를 열지 않고 상태줄만 확인한 뒤 라벨링한다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fake_herdr '
printf "%s\n" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "tab create") printf "%s\n" "{\"result\":{\"root_pane\":{\"pane_id\":\"fake:p1\"},\"tab\":{\"tab_id\":\"fake:t1\"}}}" ;;
  "pane send-text") printf "%s" "$4" > "$FAKE_DIR/echo"; printf "{}\n" ;;
  "pane send-keys") printf "{}\n" ;;
  "pane read")
    cat "$FAKE_DIR/echo" 2>/dev/null; printf "\n"
    cat "$FAKE_DIR/status" 2>/dev/null ;;
  "agent rename") printf "{}\n" ;;
  "pane rename") printf "{}\n" ;;
  "tab rename") printf "{}\n" ;;
  *) printf "{}\n" ;;
esac'
export FAKE_LOG="$WORK/calls" FAKE_DIR="$WORK"

reset_state() {
  : > "$FAKE_LOG"
  rm -f "$FAKE_DIR/echo"
  printf '%s\n' "$1" > "$FAKE_DIR/status"
}

# 1) 기본 모델 유지: /models 를 보내지 않고 상태줄 표기만 확인한 뒤 라벨링까지 진행
reset_state 'OpenCode v2.3.0
Beam Free'
set +e
run_ai_ps herdr-open-worker.sh ps-beam opencode 'beam-free' --keep-model --model-label 'Beam Free' >"$WORK/out1" 2>&1
s=$?
set -e
ok_if "keep-model 이 정상 종료" [ "$s" = 0 ]
if grep -q '/models' "$FAKE_LOG"; then
  ok "/models 를 보내지 않는다" 1
else
  ok "/models 를 보내지 않는다" 0
fi
ok_if "라벨링을 그대로 수행한다" grep -q 'agent rename fake:p1 ps-beam' "$FAKE_LOG"
ok_if "최종 출력에 대상 이름이 있다" grep -q 'ps-beam' "$WORK/out1"

# 2) 상태줄 확인 실패 시 종료(라벨링 전에 멈춤)
reset_state 'OpenCode v2.3.0
DeepSeek V4.1 Flash'
: > "$FAKE_LOG"
set +e
run_ai_ps herdr-open-worker.sh ps-beam opencode 'beam-free' --keep-model --model-label 'Beam Free' >"$WORK/out2" 2>&1
s=$?
set -e
ok_if "상태줄 불일치면 exit≠0" [ "$s" -ne 0 ]
ok_if "상태줄 불일치 사유를 알린다" grep -q '상태줄' "$WORK/out2"
if grep -Eq '(agent|pane|tab) rename' "$FAKE_LOG"; then
  ok "실패 시 agent·pane·tab rename 을 모두 건너뛴다" 1
else
  ok "실패 시 agent·pane·tab rename 을 모두 건너뛴다" 0
fi

# 2-1) --expect 이 --model-label 보다 우선한다(상태줄이 expect 에만 맞아도 통과)
reset_state 'OpenCode v2.3.0
Custom Label'
set +e
run_ai_ps herdr-open-worker.sh ps-beam opencode 'beam-free' --keep-model --model-label 'Beam Free' --expect 'Custom Label' >"$WORK/out2b" 2>&1
s=$?
set -e
ok_if "--expect 이 --model-label 보다 우선한다" [ "$s" = 0 ]
ok_if "우선순위 결과도 라벨링한다" grep -q 'agent rename fake:p1 ps-beam' "$FAKE_LOG"

# 3) codex 에 주면 오류
reset_state 'GPT-6.1-Sol high'
set +e
run_ai_ps herdr-open-worker.sh ps-sol codex gpt-6.1-sol high --keep-model >"$WORK/out3" 2>&1
s=$?
set -e
ok_if "codex 에 --keep-model 이면 exit≠0" [ "$s" -ne 0 ]
ok_if "opencode 전용임을 알린다" grep -q 'opencode 전용' "$WORK/out3"

# 4) dry-run 출력에 건너뜀이 보인다
reset_state 'OpenCode v2.3.0
Beam Free'
set +e
run_ai_ps herdr-open-worker.sh ps-beam opencode 'beam-free' --keep-model --model-label 'Beam Free' --dry-run >"$WORK/out4" 2>&1
s=$?
set -e
ok_if "dry-run 이 정상 종료" [ "$s" = 0 ]
ok_if "dry-run 에 메뉴 건너뜀이 보인다" grep -q '건너뜀' "$WORK/out4"
ok_if "dry-run 상태줄 확인에 model-label 이 쓰인다" grep -q 'verify status text "Beam Free"' "$WORK/out4"
if grep -q 'send-text.*models' "$WORK/out4"; then
  ok "dry-run 에 /models 전송이 없다" 1
else
  ok "dry-run 에 /models 전송이 없다" 0
fi

report
