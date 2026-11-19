#!/usr/bin/env bash
# Herdr 패널에 워커를 열고 CLI 모델을 지정한 뒤 라벨을 붙인다.
#
# 기본은 새 탭이다(P1: "서브로 열기"를 split으로 해석해 같은 탭에 워커가 겹쳤던 사고).
# split은 --split-of <pane> 을 명시했을 때만 한다.
#
# 대상 셸에 넣는 model·effort·role 은 모두 작은따옴표로 인용하고 허용 문자를 먼저 검증한다(B1).
# TUI 메뉴는 제목과 커서를 확인한 뒤에만 키를 보내고, 어느 단계든 실패하면 다음 키 없이 종료한다(B2).
#
# 사용:
#   scripts/herdr-open-worker.sh <name> <codex|claude|opencode> <model> [effort] [옵션]
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/herdr.sh
. "$script_dir/lib/herdr.sh"

usage() {
  cat <<'USAGE'
사용: scripts/herdr-open-worker.sh <name> <codex|claude|opencode> <model> [effort] [옵션]

Herdr 패널에 워커를 열고(기본: 새 탭) CLI 모델을 지정한 뒤 에이전트·패널·탭 라벨을 맞춘다.
name 은 소문자·숫자·하이픈만, model·effort 는 영문·숫자·._:/- 만 쓸 수 있다.

옵션:
  --split-of <pane>          새 탭 대신 지정 패널을 분할한다(명시할 때만)
  --direction <right|down>   분할 방향(기본 down)
  --provider '<문구>'        opencode 모델 목록에서 고를 공급자 줄(예: "Ollama Cloud")
  --model-label '<문구>'     화면에 보이는 모델 표기(기본: model). slug와 표기가 다를 때 준다
  --search '<문구>'          opencode 모델 검색창에 입력할 문자열(기본: model)
  --keep-model               opencode 의 /models 선택을 건너뛰고 기본 모델(예: Beam Free)을 유지한다.
                             이때 effort·--provider 는 설정이 아니라 현재 상태가 일치하는지 확인하는 조건이며
                             (예: '... high --keep-model' 은 high 로 바꾸라는 뜻이 아니라 지금 high 인지 확인),
                             --search 는 쓰지 않는다.
  --role '<문구>'            claude --append-system-prompt 로 넘길 역할 설명
  --cwd <경로>               패널 작업 디렉터리(기본: git 최상위)
  --expect '<문자열>'        상태줄 검증 문자열(기본값 순서: --expect > --model-label > model)
  --dry-run                  실행할 명령·키 순서만 출력한다
  --help

예:
  scripts/herdr-open-worker.sh ps-ds opencode 'deepseek-v4.1-flash:1017' high --provider 'Ollama Cloud' --dry-run
  scripts/herdr-open-worker.sh ps-sol codex gpt-6.1-sol high
  scripts/herdr-open-worker.sh ps-beam opencode 'beam-free' --keep-model --model-label 'Beam Free'
USAGE
}

name=""; agent=""; model=""; effort=""
split_of=""; direction="down"; provider=""; role=""; cwd=""; expect=""; search=""; model_label=""; keep_model=""
pos=0

while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) HERDR_DRY_RUN=1; shift ;;
    --split-of) [ $# -ge 2 ] || herdr_die "--split-of 값이 필요합니다."; split_of=$2; shift 2 ;;
    --direction) [ $# -ge 2 ] || herdr_die "--direction 값이 필요합니다."; direction=$2; shift 2 ;;
    --provider) [ $# -ge 2 ] || herdr_die "--provider 값이 필요합니다."; provider=$2; shift 2 ;;
    --role) [ $# -ge 2 ] || herdr_die "--role 값이 필요합니다."; role=$2; shift 2 ;;
    --cwd) [ $# -ge 2 ] || herdr_die "--cwd 값이 필요합니다."; cwd=$2; shift 2 ;;
    --expect) [ $# -ge 2 ] || herdr_die "--expect 값이 필요합니다."; expect=$2; shift 2 ;;
    --search) [ $# -ge 2 ] || herdr_die "--search 값이 필요합니다."; search=$2; shift 2 ;;
    --model-label) [ $# -ge 2 ] || herdr_die "--model-label 값이 필요합니다."; model_label=$2; shift 2 ;;
    --keep-model) keep_model=1; shift ;;
    -*) herdr_die "알 수 없는 옵션: $1" ;;
    *)
      pos=$((pos + 1))
      case $pos in
        1) name=$1 ;;
        2) agent=$1 ;;
        3) model=$1 ;;
        4) effort=$1 ;;
        *) herdr_die "인자가 너무 많습니다: $1" ;;
      esac
      shift
      ;;
  esac
done

[ -n "$name" ] && [ -n "$agent" ] && [ -n "$model" ] || { usage >&2; exit 64; }
case "$agent" in codex|claude|opencode) ;; *) herdr_die "에이전트는 codex|claude|opencode 중 하나입니다." ;; esac
case "$direction" in right|down) ;; *) herdr_die "--direction 은 right|down 입니다." ;; esac
if [ -n "$keep_model" ] && [ "$agent" != "opencode" ]; then
  herdr_die "--keep-model 은 opencode 전용입니다."
fi

# B1: 대상 셸에 들어가는 값은 형태를 먼저 제한한다.
case "$name" in
  ''|*[!a-z0-9-]*) herdr_die "name 은 소문자·숫자·하이픈만 쓸 수 있습니다(현재: '$name')." ;;
esac
case "$model" in
  *[!A-Za-z0-9._:/-]*) herdr_die "model 은 영문·숫자·._:/- 만 쓸 수 있습니다(현재: '$model')." ;;
esac
if [ -n "$effort" ]; then
  case "$effort" in
    *[!A-Za-z0-9._:/-]*) herdr_die "effort 는 영문·숫자·._:/- 만 쓸 수 있습니다(현재: '$effort')." ;;
  esac
fi

# codex·claude 는 effort 인자가 필수에 가깝다. opencode 는 variant 목록이 있을 때만 쓴다.
if [ -z "$effort" ] && [ "$agent" != "opencode" ]; then effort=high; fi
cwd=${cwd:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
expect=${expect:-${model_label:-$model}}
case "$expect" in */*) expect=${expect##*/} ;; esac
case "$expect" in *:*) expect=${expect%%:*} ;; esac

herdr_check_env
herdr_require jq
herdr_require_workspace
workspace=$(herdr_workspace)

models_title=${HERDR_OPENCODE_MODELS_TITLE:-'Select [Mm]odel|[Mm]odels'}
variant_title=${HERDR_OPENCODE_VARIANT_TITLE:-'Select [Vv]ariant|[Vv]ariant'}

# 1) 패널 생성: 기본은 새 탭, --split-of 가 있으면 그 패널을 분할한다.
pane=""; tab=""
if [ -n "$split_of" ]; then
  if herdr_is_dry; then
    herdr_call pane split --pane "$split_of" --direction "$direction" --cwd "$cwd"
  else
    split_json=$(herdr pane split --pane "$split_of" --direction "$direction" --cwd "$cwd")
    pane=$(printf '%s' "$split_json" | jq -r '(.result.pane.pane_id // .result.root_pane.pane_id // .result.pane_id) // empty')
    [ -n "$pane" ] || herdr_die "분할 패널 ID를 읽지 못했습니다."
  fi
else
  if herdr_is_dry; then
    herdr_call tab create --workspace "$workspace" --cwd "$cwd" --label "$name"
  else
    tab_json=$(herdr tab create --workspace "$workspace" --cwd "$cwd" --label "$name")
    pane=$(printf '%s' "$tab_json" | jq -r '.result.root_pane.pane_id // empty')
    tab=$(printf '%s' "$tab_json" | jq -r '.result.tab.tab_id // empty')
    [ -n "$pane" ] || herdr_die "새 탭의 패널 ID를 읽지 못했습니다."
  fi
fi
pane=${pane:-<pane>}

# 2) CLI 실행. 인자는 모두 인용해 대상 셸의 재해석을 막는다(B1).
case "$agent" in
  codex) launch="codex -m $(herdr_quote "$model") -c $(herdr_quote "model_reasoning_effort=\"$effort\"")" ;;
  claude)
    launch="claude --model $(herdr_quote "$model") --effort $(herdr_quote "$effort")"
    [ -n "$role" ] && launch="$launch --append-system-prompt $(herdr_quote "$role")"
    ;;
  opencode) launch="opencode" ;;
esac
herdr_send_text "$pane" "$launch"
herdr_wait_echo "$pane" "$launch" || herdr_die "CLI 실행 문자열이 화면에 보이지 않습니다. 패널($pane)을 직접 확인해 주세요."
herdr_enter "$pane"

# 3) opencode 는 -m 옵션이 없다(P2). TUI 메뉴는 제목+커서를 확인한 뒤에만 조작한다(B2).
#    --keep-model 은 메뉴를 열지 않고 기본 모델을 유지한 채 상태줄 확인만 한다.
if [ "$agent" = "opencode" ] && [ -n "$keep_model" ]; then
  if herdr_is_dry; then
    printf '[dry-run] keep-model: /models 메뉴 건너뜀, 상태줄에서 "%s"만 확인\n' "$expect"
  fi
  herdr_wait_for "$pane" 'opencode|OpenCode|│|[❯›]' 60 || herdr_die "OpenCode 화면이 준비되지 않았습니다."
elif [ "$agent" = "opencode" ]; then
  herdr_wait_for "$pane" 'opencode|OpenCode|│|[❯›]' 60 || herdr_die "OpenCode 화면이 준비되지 않았습니다."
  herdr_send_text "$pane" "/models"
  herdr_wait_echo "$pane" "/models" || herdr_die "OpenCode 에 '/models' 입력이 반영되지 않았습니다."
  herdr_enter "$pane"
  herdr_wait_menu "$pane" "$models_title" "${HERDR_STEP_TIMEOUT}" || herdr_die "모델 선택 메뉴를 확인하지 못했습니다. 패널($pane)을 직접 확인해 주세요."

  herdr_send_text "$pane" "${search:-$model}"
  herdr_wait_echo "$pane" "${search:-$model}" || herdr_die "모델 검색어가 입력되지 않았습니다."
  match_label=${model_label:-$model}
  if herdr_is_dry; then
    printf '[dry-run] row-select model="%s"%s (live: 커서 위치에서 목표까지 이동 후 Enter 전 재확인)\n' "$match_label" "${provider:+ provider=\"$provider\"}"
  else
    scan=$(herdr_row_scan "$(herdr_visible "$pane")" "$match_label" "$provider" "$models_title")
    target=$(printf '%s\n' "$scan" | sed -n 1p)
    cursor=$(printf '%s\n' "$scan" | sed -n 2p)
    if [ "$target" -lt 0 ]; then
      herdr_die "모델 목록에서 '$match_label'${provider:+ · $provider} 항목을 찾지 못했습니다. 표기가 다르면 --model-label/--provider 로 알려 주세요(패널 $pane)."
    fi
    if [ "$cursor" -lt 0 ]; then
      herdr_die "모델 목록에서 현재 커서를 찾지 못했습니다(패널 $pane)."
    fi
    delta=$((target - cursor))
    while [ "$delta" -gt 0 ]; do herdr_send_keys "$pane" Down; delta=$((delta - 1)); done
    while [ "$delta" -lt 0 ]; do herdr_send_keys "$pane" Up; delta=$((delta + 1)); done
    # Enter 직전 재확인: 커서 줄이 목표 모델(+공급자)인지 정규화 비교
    if ! herdr_cursor_matches "$pane" "$match_label" "$provider" "$models_title"; then
      herdr_die "커서가 목표 모델('$match_label')${provider:+ · '$provider'}에 있지 않습니다. Enter 를 보내지 않고 중단합니다(패널 $pane)."
    fi
  fi
  herdr_enter "$pane"
  if [ -n "$effort" ]; then
    herdr_wait_menu "$pane" "$variant_title" "${HERDR_VARIANT_TIMEOUT}" || herdr_die "variant 선택 메뉴를 확인하지 못했습니다. effort 를 보내지 않고 중단합니다(패널 $pane)."
    herdr_send_text "$pane" "$effort"
    herdr_wait_echo "$pane" "$effort" || herdr_die "variant 검색어가 입력되지 않았습니다."
    herdr_enter "$pane"
  fi
fi

# 4) 상태줄(마지막 한 줄)에서 모델·공급자·effort 를 확인한다. 실패하면 라벨 없이 종료한다.
herdr_verify_text "$pane" "$expect" "${HERDR_VERIFY_TIMEOUT}" || herdr_die "상태줄에서 '$expect' 을(를) 확인하지 못했습니다. 패널($pane)의 모델 선택을 직접 확인해 주세요."
if [ -n "$provider" ]; then
  herdr_verify_text "$pane" "$provider" "${HERDR_VERIFY_TIMEOUT}" || herdr_die "상태줄에서 공급자 '$provider' 을(를) 확인하지 못했습니다(패널 $pane)."
fi
if [ -n "$effort" ] && [ "$agent" = "opencode" ]; then
  herdr_verify_effort "$pane" "$effort" "${HERDR_VERIFY_TIMEOUT}" || herdr_die "상태줄에서 effort '$effort' 을(를) 확인하지 못했습니다(패널 $pane)."
fi

# 5) 라벨: 에이전트 → 패널 → 탭(새 탭일 때만). 실패를 숨기지 않고 종료 코드로 알린다.
final=$(herdr_rename_agent "$pane" "$name") || herdr_die "에이전트 이름 지정에 실패했습니다(패널 $pane)."
tab_arg=${tab:-<tab>}
if herdr_is_dry; then
  herdr_call pane rename "$pane" "$final"
  if [ -z "$split_of" ]; then herdr_call tab rename "$tab_arg" "$final"; fi
else
  herdr pane rename "$pane" "$final" >/dev/null 2>&1 || herdr_die "패널 라벨 지정에 실패했습니다(패널 $pane)."
  if [ -z "$split_of" ]; then
    herdr tab rename "$tab_arg" "$final" >/dev/null 2>&1 || herdr_die "탭 라벨 지정에 실패했습니다(탭 ${tab:-?})."
  fi
fi

printf '패널 %s · %s · 모델 %s%s → %s\n' "$pane" "$agent" "$model" "${effort:+ · $effort}" "$final"
