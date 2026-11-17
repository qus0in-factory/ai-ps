#!/usr/bin/env bash
# 실행 중인 워커의 effort(추론 강도)만 바꾼다. 모델은 그대로 두고 세션에만 적용한다.
#
# codex  : /model → (현재 모델) enter → 레벨 커서 이동 → s
#          enter 로 끝내면 전역 config 기본값이 바뀌므로 반드시 s(P4).
# opencode: /models → 현재 모델 확인 → variant 목록에서 검색어 입력 → enter
#
# 메뉴는 제목과 커서를 확인한 뒤에만 조작하고, 확인에 실패하면 다음 키 없이 종료한다(B2).
# effort 비교는 완전 일치다(xhigh ≠ high).
#
# 사용: scripts/herdr-set-effort.sh <name> <effort> [--agent codex|opencode] [--model <현재 모델>] [--dry-run]
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/herdr.sh
. "$script_dir/lib/herdr.sh"

usage() {
  cat <<'USAGE'
사용: scripts/herdr-set-effort.sh <에이전트이름> <effort> [옵션]

실행 중인 워커의 effort 를 세션 한정으로 바꾼다. 모델 선택은 건드리지 않는다.
메뉴 제목·커서를 확인하지 못하면 키를 더 보내지 않고 실패한다.

옵션:
  --agent <codex|opencode>  에이전트 종류를 직접 지정한다(생략 시 herdr agent get 으로 판별)
  --model <문자열>           opencode 에서 지금 떠 있는 모델(현재 커서 확인용, opencode 는 필수)
  --provider '<문구>'        opencode 공급자 표시 문자열. 생략하면 변경 전 상태줄에서 읽는다
  --model-label '<문구>'     화면 표기 모델명(기본: --model 값)
  --dry-run                  실행할 명령·키 순서만 출력한다
  --help

환경:
  HERDR_CODEX_EFFORTS   codex 레벨 순서(기본: "minimal low medium high xhigh")

예:
  scripts/herdr-set-effort.sh ps-sol high
  scripts/herdr-set-effort.sh ps-ds max --agent opencode --model deepseek-v4.1-flash --provider 'Ollama Cloud' --dry-run
USAGE
}

name=""; effort=""; agent=""; model=""; provider=""; model_label=""
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) HERDR_DRY_RUN=1; shift ;;
    --agent) [ $# -ge 2 ] || herdr_die "--agent 값이 필요합니다."; agent=$2; shift 2 ;;
    --model) [ $# -ge 2 ] || herdr_die "--model 값이 필요합니다."; model=$2; shift 2 ;;
    --provider) [ $# -ge 2 ] || herdr_die "--provider 값이 필요합니다."; provider=$2; shift 2 ;;
    --model-label) [ $# -ge 2 ] || herdr_die "--model-label 값이 필요합니다."; model_label=$2; shift 2 ;;
    -*) herdr_die "알 수 없는 옵션: $1" ;;
    *)
      if [ -z "$name" ]; then name=$1
      elif [ -z "$effort" ]; then effort=$1
      else herdr_die "인자가 너무 많습니다: $1"
      fi
      shift
      ;;
  esac
done

[ -n "$name" ] && [ -n "$effort" ] || { usage >&2; exit 64; }

efforts=${HERDR_CODEX_EFFORTS:-"minimal low medium high xhigh"}
# zsh 단어분리 함정(P3)을 피하려고 공백 목록은 배열로만 다룬다.
IFS=' ' read -r -a effort_words <<< "$efforts"
model_title=${HERDR_CODEX_MODEL_TITLE:-'Select [Mm]odel'}
level_title=${HERDR_CODEX_LEVEL_TITLE:-'Select (Reasoning )?[Ll]evel|Reasoning [Ll]evel'}
variant_title=${HERDR_OPENCODE_VARIANT_TITLE:-'Select [Vv]ariant|[Vv]ariant'}
models_title=${HERDR_OPENCODE_MODELS_TITLE:-'Select [Mm]odel|[Mm]odels'}

# <needle> <단어 배열...> → 0-based 순번, 없으면 -1. 완전 일치만 본다.
word_index() {
  local needle=$1 i=0 w
  shift
  for w in "$@"; do
    if [ "$w" = "$needle" ]; then printf '%s' "$i"; return 0; fi
    i=$((i + 1))
  done
  printf '%s' -1
}

herdr_check_env
herdr_require jq

if [ -z "$agent" ]; then
  if herdr_is_dry; then
    herdr_die "--dry-run 에서는 --agent codex|opencode 를 함께 지정해 주세요(실제 에이전트 조회를 피함)."
  fi
  agent=$(herdr agent get "$name" 2>/dev/null | jq -r '.result.agent.agent // empty')
fi
case "$agent" in
  codex|opencode) ;;
  *) herdr_die "'$name' 의 에이전트 종류를 알 수 없습니다(--agent 로 지정)." ;;
esac

pane=$name
if herdr_is_dry; then
  pane="<pane:$name>"
else
  pane=$(herdr agent get "$name" 2>/dev/null | jq -r '.result.agent.pane_id // empty')
  [ -n "$pane" ] || herdr_die "'$name' 패널을 찾지 못했습니다."
fi

case "$agent" in
  codex)
    # effort 이름은 키를 보내기 전에 검증한다(오타로 메뉴를 열어 둔 채 실패하지 않게).
    target=$(word_index "$effort" "${effort_words[@]}")
    [ "$target" -ge 0 ] || herdr_die "알 수 없는 effort: $effort (가능: $efforts)"
    # 1) /model 메뉴: 제목과 커서가 보일 때까지 기다린 뒤에만 enter
    herdr_send_text "$pane" "/model"
    herdr_wait_echo "$pane" "/model" || herdr_die "'/model' 입력이 반영되지 않았습니다(패널 $pane)."
    herdr_enter "$pane"
    herdr_wait_menu "$pane" "$model_title" "${HERDR_STEP_TIMEOUT}" || herdr_die "모델 메뉴를 확인하지 못했습니다(패널 $pane). 키를 더 보내지 않습니다."
    # 2) 현재 모델을 그대로 확정(모델 변경 없음)
    herdr_enter "$pane"
    herdr_wait_menu "$pane" "$level_title" "${HERDR_STEP_TIMEOUT}" || herdr_die "effort 레벨 메뉴를 확인하지 못했습니다(패널 $pane). s 를 보내지 않았습니다."
    # 3) 레벨 이동: 확인된 메뉴 화면에서 현재 레벨을 찾고 목표까지 화살표만 누른다
    if herdr_is_dry; then
      printf '[dry-run] level %s (0-based %s) 로 이동 후 s (live에서 현재 커서 확인)\n' "$effort" "$target"
    else
      current=$(herdr_menu_index "$HERDR_MENU_SCREEN" "${effort_words[@]}")
      if [ "$current" -lt 0 ]; then
        herdr_die "레벨 메뉴에서 현재 선택(커서)을 찾지 못했습니다(패널 $pane). s 를 보내지 않았습니다."
      fi
      delta=$((target - current))
      while [ "$delta" -gt 0 ]; do herdr_send_keys "$pane" Down; delta=$((delta - 1)); done
      while [ "$delta" -lt 0 ]; do herdr_send_keys "$pane" Up; delta=$((delta + 1)); done
    fi
    # 4) enter 금지: 세션 한정 적용 키
    herdr_send_keys "$pane" s
    herdr_verify_effort "$pane" "$effort" "${HERDR_VERIFY_TIMEOUT}" || herdr_die "상태줄에서 effort '$effort' 을(를) 확인하지 못했습니다. 세션 값이 적용되지 않았을 수 있습니다(패널 $pane)."
    ;;
  opencode)
    if herdr_is_dry && [ -z "$model" ]; then
      model="<--model 필요>"
    fi
    [ -n "$model" ] || herdr_die "opencode 는 --model <현재 모델> 이 필요합니다(현재 커서가 그 모델인지 확인하기 위함)."
    match_label=${model_label:-$model}
    # 공급자 기준: --provider 가 있으면 그것, 없으면 **변경 전 상태줄**에서 읽는다(메뉴 커서가 아님).
    if herdr_is_dry; then
      provider_before=${provider:-<상태줄에서 읽음>}
    else
      before_line=$(herdr_last_line "$(herdr_visible "$pane")")
      if [ -n "$provider" ]; then
        provider_before=$provider
      else
        provider_before=$(herdr_status_provider "$before_line" "$match_label") ||
          herdr_die "상태줄에서 공급자를 읽지 못했습니다. 상태줄 표기를 확인하거나 --provider '<공급자>'를 지정해 주세요(패널 $pane)."
      fi
      herdr_verify_text "$pane" "$provider_before" "${HERDR_VERIFY_TIMEOUT}" ||
        herdr_die "변경 전 상태줄에 공급자 '$provider_before' 이(가) 보이지 않습니다(패널 $pane)."
    fi
    herdr_send_text "$pane" "/models"
    herdr_wait_echo "$pane" "/models" || herdr_die "'/models' 입력이 반영되지 않았습니다(패널 $pane)."
    herdr_enter "$pane"
    herdr_wait_menu "$pane" "$models_title" "${HERDR_STEP_TIMEOUT}" || herdr_die "모델 목록을 확인하지 못했습니다(패널 $pane)."
    # 현재 커서가 --model(과 --provider)과 같은지 확인한 뒤에만 움직인다.
    if herdr_is_dry; then
      printf '[dry-run] verify cursor row "%s"%s on %s; 목표까지 이동 후 재확인\n' "$match_label" "${provider:+ · $provider}" "$pane"
    else
      target_provider=${provider:-$provider_before}
      scan=$(herdr_row_scan "$HERDR_MENU_SCREEN" "$match_label" "$target_provider" "$models_title")
      target=$(printf '%s\n' "$scan" | sed -n 1p)
      cursor=$(printf '%s\n' "$scan" | sed -n 2p)
      if [ "$cursor" -lt 0 ]; then
        herdr_die "모델 목록에서 커서 줄을 찾지 못했습니다(패널 $pane)."
      fi
      cursor_norm=$(herdr_normalize "$(printf '%s\n' "$scan" | sed -n 3p)")
      case "$cursor_norm" in
        *"$(herdr_normalize "$match_label")"*) ;;
        *) herdr_die "현재 커서가 지정한 모델('$match_label')이 아닙니다. 모델을 바꾸지 않고 중단합니다(패널 $pane)." ;;
      esac
      case "$cursor_norm" in
        *"$(herdr_normalize "$target_provider")"*) ;;
        *) herdr_die "현재 커서의 공급자가 '$target_provider' 과 다릅니다. 모델을 바꾸지 않고 중단합니다(패널 $pane)." ;;
      esac
      [ "$target" -ge 0 ] || herdr_die "모델 목록에서 '$match_label · $target_provider' 항목을 찾지 못했습니다(패널 $pane)."
      delta=$((target - cursor))
      while [ "$delta" -gt 0 ]; do herdr_send_keys "$pane" Down; delta=$((delta - 1)); done
      while [ "$delta" -lt 0 ]; do herdr_send_keys "$pane" Up; delta=$((delta + 1)); done
      if ! herdr_cursor_matches "$pane" "$match_label" "$target_provider" "$models_title"; then
        herdr_die "Enter 직전 커서가 '$match_label · $target_provider' 가 아닙니다. 중단합니다(패널 $pane)."
      fi
    fi
    herdr_enter "$pane"
    herdr_wait_menu "$pane" "$variant_title" "${HERDR_STEP_TIMEOUT}" || herdr_die "variant 목록을 확인하지 못했습니다(패널 $pane). 키를 더 보내지 않습니다."
    herdr_send_text "$pane" "$effort"
    herdr_wait_echo "$pane" "$effort" || herdr_die "variant 검색어가 입력되지 않았습니다(패널 $pane)."
    herdr_enter "$pane"
    herdr_verify_effort "$pane" "$effort" "${HERDR_VERIFY_TIMEOUT}" || herdr_die "상태줄에서 effort '$effort' 을(를) 확인하지 못했습니다(패널 $pane)."
    # 1) 모델과 공급자가 바뀌지 않았는지 확인한다. 공급자 기준은 변경 전 상태줄이다.
    if ! herdr_is_dry; then
      herdr_verify_text "$pane" "$match_label" "${HERDR_VERIFY_TIMEOUT}" ||
        herdr_die "상태줄의 모델 표기가 바뀌었습니다(패널 $pane)."
      herdr_verify_text "$pane" "$provider_before" "${HERDR_VERIFY_TIMEOUT}" ||
        herdr_die "상태줄의 공급자가 '$provider_before' 과 달라졌습니다(패널 $pane)."
    fi
    ;;
esac

if herdr_is_dry; then
  printf '[dry-run] %s → effort %s (%s)\n' "$name" "$effort" "$agent"
else
  printf '%s → effort %s (%s) 적용. 상태줄에서 확인하세요.\n' "$name" "$effort" "$agent"
fi
