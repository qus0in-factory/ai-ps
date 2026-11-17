#!/usr/bin/env bash
# 현재 Herdr 워크스페이스에서 모델을 감지해 탭·패널·에이전트 라벨을 "<접두어><약칭>" 으로 맞춘다.
# zzik scripts/herdr-label-models.sh 를 ai-ps 접두어(ps-)에 맞게 옮긴 판본.
#
# 같은 CLI에 모델이 여럿이면 agent 필드가 아니라 상태줄로 판정한다.
# 탭 라벨은 탭의 첫 패널 이름으로 한 번만 바꾼다(마지막 패널이 탭 이름을 덮어쓰지 않게).
#
# 사용: scripts/herdr-label-models.sh [--dry-run] [--force] [--prefix ps-] [workspace_id]
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/herdr.sh
. "$script_dir/lib/herdr.sh"

usage() {
  cat <<'USAGE'
사용: scripts/herdr-label-models.sh [--dry-run] [--force] [--prefix ps-] [workspace_id]

워크스페이스의 각 패널 화면 하단 상태줄에서 모델을 감지해
에이전트·패널·탭 라벨을 "<접두어><약칭>" 으로 지정한다.
탭 라벨은 탭마다 첫 패널 기준으로 한 번만 바꾼다. 감지 실패 패널은 그대로 둔다.

옵션:
  --dry-run        감지 결과만 출력한다(패널 변경 없음)
  --force          이미 이름이 있는 에이전트도 덮어쓴다
  --prefix <문구>  라벨 접두어(기본 ps-)
  --help

환경:
  SELF_LABEL       이 스크립트를 실행 중인 패널에 강제로 붙일 이름(예: ps-opus)
USAGE
}

force=false
prefix="ps-"
ws=""
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) HERDR_DRY_RUN=1; shift ;;
    --force) force=true; shift ;;
    --prefix) [ $# -ge 2 ] || herdr_die "--prefix 값이 필요합니다."; prefix=$2; shift 2 ;;
    -*) herdr_die "알 수 없는 옵션: $1" ;;
    *) ws=$1; shift ;;
  esac
done

herdr_check_env
herdr_require jq

# 화면 맨 아래 상태줄 영역(마지막 8개 비어 있지 않은 줄)만 본다. 본문 인용문에 속지 않기 위함이다.
screen_bottom() { herdr_bottom_lines "$1"; }

# <agent> <screen> → 약칭(없으면 빈 문자열). 상태줄을 아래에서 위로 훑어 가장 가까운 표시를 쓴다.
detect() {
  local agent=$1 screen=$2
  local bottom line ver='[0-9][0-9.]*'
  bottom=$(screen_bottom "$screen")
  case "$agent" in
    codex)
      # 같은 CLI에 Sol·Astra 가 있으므로 agent 필드로 단정하지 않고 상태줄을 본다.
      while IFS= read -r line; do
        case "$line" in
          *Astra*) printf 'astra'; return 0 ;;
          *Sol*) printf 'sol'; return 0 ;;
        esac
      done < <(printf '%s\n' "$bottom" | awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}')
      ;;
    opencode)
      while IFS= read -r line; do
        case "$line" in
          *GPT-*Sol*) printf 'sol'; return 0 ;;
        esac
        if printf '%s' "$line" | grep -Eq "Hy$ver"; then printf 'hf'; return 0; fi
        if printf '%s' "$line" | grep -Eq "DeepSeek[[:space:]]+[Vv]?$ver"; then printf 'ds'; return 0; fi
        if printf '%s' "$line" | grep -Eq "GLM-$ver"; then printf 'glm'; return 0; fi
        if printf '%s' "$line" | grep -Eq "Beam[[:space:]]+Free"; then printf 'beam'; return 0; fi
      done < <(printf '%s\n' "$bottom" | awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}')
      ;;
    claude)
      while IFS= read -r line; do
        if printf '%s' "$line" | grep -Eq "Opus[[:space:]]+$ver"; then printf 'opus'; return 0; fi
        if printf '%s' "$line" | grep -Eq "Fable[[:space:]]+$ver"; then printf 'fable'; return 0; fi
        if printf '%s' "$line" | grep -Eq "Sonnet[[:space:]]+$ver"; then printf 'sonnet'; return 0; fi
      done < <(printf '%s\n' "$bottom" | awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}')
      ;;
  esac
  printf ''
}

ws=${ws:-${HERDR_WORKSPACE_ID:-}}
[ -n "$ws" ] || herdr_die "워크스페이스 ID가 없습니다. Herdr 패널 안에서 실행하거나 인자로 넘겨 주세요."

agents=$(herdr agent list 2>/dev/null | jq -r --arg ws "$ws" \
  '.result.agents[] | select(.workspace_id == $ws) | [.pane_id, .tab_id, (.agent // ""), (.name // "")] | @tsv')

renamed_tabs=" "
failed=0

while IFS=$'\t' read -r pane tab agent current; do
  [ -n "${pane:-}" ] || continue
  if [ -n "$current" ] && [ "$force" != true ]; then
    printf '%s: 이미 이름 있음(%s), 건너뜀\n' "$pane" "$current"
    continue
  fi
  if [ "$pane" = "${HERDR_PANE_ID:-}" ] && [ -n "${SELF_LABEL:-}" ]; then
    # 이 스크립트를 실행 중인 패널은 상태줄에 모델 표시가 없을 수 있다.
    label=$SELF_LABEL
  else
    abbr=$(detect "$agent" "$(herdr_visible "$pane")")
    if [ -z "$abbr" ]; then
      printf '%s (%s): 모델 감지 실패, 건너뜀\n' "$pane" "${agent:-?}"
      continue
    fi
    case "$abbr" in
      "$prefix"*) label=$abbr ;;
      *) label="${prefix}${abbr}" ;;
    esac
  fi
  if herdr_is_dry; then
    printf '%s (%s): [dry-run] → %s\n' "$pane" "${agent:-?}" "$label"
    case "$renamed_tabs" in *" $tab "*) ;; *) printf '[dry-run] herdr tab rename %s %s\n' "$tab" "$label"; renamed_tabs="$renamed_tabs$tab " ;; esac
    continue
  fi
  if ! target=$(herdr_rename_agent "$pane" "$label"); then
    failed=1
    continue
  fi
  if ! herdr pane rename "$pane" "$target" >/dev/null 2>&1; then
    herdr_warn "$pane: 패널 라벨 지정 실패"
    failed=1
  fi
  # 탭 라벨은 탭의 첫 패널 이름으로 한 번만 지정한다.
  case "$renamed_tabs" in
    *" $tab "*) ;;
    *)
      if herdr tab rename "$tab" "$target" >/dev/null 2>&1; then
        renamed_tabs="$renamed_tabs$tab "
      else
        herdr_warn "$pane: 탭 라벨 지정 실패"
        failed=1
      fi
      ;;
  esac
  printf '%s (%s) → %s\n' "$pane" "$tab" "$target"
done < <(printf '%s\n' "$agents")

[ "$failed" = 0 ] || exit 1
