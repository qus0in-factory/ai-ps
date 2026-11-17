#!/usr/bin/env bash
# 항목 5: label dry-run 도 화면 읽기(읽기 전용)는 수행하고 rename 만 생략한다.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fake_herdr '
printf "%s\n" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "agent list") printf "{\"result\":{\"agents\":[{\"workspace_id\":\"fake-ws\",\"pane_id\":\"fake:p1\",\"tab_id\":\"fake:t1\",\"agent\":\"codex\",\"name\":\"\"}]}}\n" ;;
  "pane read") printf "GPT-6.1-Sol high\n" ;;
  "agent rename") printf "{\"result\":{\"name\":\"renamed\"}}\n" ;;
  *) printf "{}\n" ;;
esac'
export FAKE_LOG="$WORK/calls"
: > "$FAKE_LOG"

set +e
run_ai_ps herdr-label-models.sh --dry-run >"$WORK/out" 2>&1
status=$?
set -e
ok_if "label --dry-run 이 정상 종료" [ "$status" = 0 ]
ok_if "dry-run 에서도 화면을 읽어 모델을 감지한다" grep -q "ps-sol" "$WORK/out"
ok_if "읽기 전용 조회는 실제로 수행" grep -q "pane read fake:p1" "$FAKE_LOG"
if grep -q "rename" "$FAKE_LOG"; then
  ok "rename 은 호출하지 않는다" 1
else
  ok "rename 은 호출하지 않는다" 0
fi

report
