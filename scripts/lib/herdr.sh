#!/usr/bin/env bash
# ai-ps Herdr 운영 스크립트 공통 헬퍼.
# 실행하지 말고 source 해서 쓴다:  . "$(dirname "$0")/lib/herdr.sh"
#
# 원칙
# - macOS에는 timeout(1)이 없다. 모든 대기는 이 파일의 폴링 루프로 하고,
#   화면 읽기는 남은 시간을 한도로 실행하며, 초과 시 SIGTERM → 유예 → SIGKILL로 끝낸다.
# - TUI 메뉴는 제목과 커서 표시를 확인한 뒤에만 키를 보낸다. 확인 실패는 곧바로 실패다.
# - 읽기 전용 조회(pane read, agent list/get)는 dry-run에서도 실제로 수행한다.
#   막는 것은 패널을 바꾸는 명령(send-text/send-keys/rename/split/tab create)뿐이다.
# - zsh에서 호출해도 안전하도록 명령 인자는 항상 배열/개별 인용으로 넘긴다(P3).

HERDR_DRY_RUN=${HERDR_DRY_RUN:-0}
HERDR_STEP_TIMEOUT=${HERDR_STEP_TIMEOUT:-20}
HERDR_VERIFY_TIMEOUT=${HERDR_VERIFY_TIMEOUT:-30}
HERDR_READ_TIMEOUT=${HERDR_READ_TIMEOUT:-10}
HERDR_VARIANT_TIMEOUT=${HERDR_VARIANT_TIMEOUT:-10}
HERDR_POLL_SECONDS=${HERDR_POLL_SECONDS:-0.5}

herdr_die() { printf '오류: %s\n' "$*" >&2; exit 1; }
herdr_warn() { printf '경고: %s\n' "$*" >&2; }
herdr_is_dry() { [ "${HERDR_DRY_RUN:-0}" = 1 ]; }

herdr_require() {
  command -v "$1" >/dev/null 2>&1 || herdr_die "'$1' 명령이 필요합니다."
}

# 초 단위 timeout 을 10진 정수로 검증한다(`08` 같은 8진수 해석 방지).
# herdr_die 는 현재 셸에서 종료해야 하므로 명령 치환으로 감싸지 않는다.
herdr_check_timeout() { # <이름> <값> <최소>
  local name=$1 raw=$2 min=$3
  case "$raw" in
    ''|*[!0-9]*) herdr_die "$name 은(는) ${min} 이상의 정수여야 합니다(현재: '$raw')." ;;
  esac
  [ "$((10#$raw))" -ge "$min" ] || herdr_die "$name 은(는) ${min} 이상의 정수여야 합니다(현재: '$raw')."
}

# 폴링 간격: 0보다 큰 10진 소수만 허용한다(`0`, `.`, `1.`, `oops` 거부).
herdr_check_interval() { # <이름> <값>
  local name=$1 raw=$2
  case "$raw" in
    ''|*[!0-9.]*|*.*.*|.) herdr_die "$name 은(는) 0보다 큰 숫자여야 합니다(현재: '$raw')." ;;
  esac
  case "$raw" in
    *.) herdr_die "$name 은(는) 0보다 큰 숫자여야 합니다(현재: '$raw')." ;;
  esac
  awk -v v="$raw" 'BEGIN { exit (v > 0) ? 0 : 1 }' || herdr_die "$name 은(는) 0보다 큰 숫자여야 합니다(현재: '$raw')."
}

herdr_check_timeout HERDR_STEP_TIMEOUT "$HERDR_STEP_TIMEOUT" 1
herdr_check_timeout HERDR_VERIFY_TIMEOUT "$HERDR_VERIFY_TIMEOUT" 1
herdr_check_timeout HERDR_READ_TIMEOUT "$HERDR_READ_TIMEOUT" 1
herdr_check_timeout HERDR_VARIANT_TIMEOUT "$HERDR_VARIANT_TIMEOUT" 1
herdr_check_interval HERDR_POLL_SECONDS "$HERDR_POLL_SECONDS"

# 검증 후에는 모두 10진 정수로 정규화해 쓴다.
HERDR_STEP_TIMEOUT=$((10#$HERDR_STEP_TIMEOUT))
HERDR_VERIFY_TIMEOUT=$((10#$HERDR_VERIFY_TIMEOUT))
HERDR_READ_TIMEOUT=$((10#$HERDR_READ_TIMEOUT))
HERDR_VARIANT_TIMEOUT=$((10#$HERDR_VARIANT_TIMEOUT))

herdr_check_env() {
  herdr_is_dry && return 0
  [ "${HERDR_ENV:-}" = 1 ] || herdr_die "Herdr 패널 안에서 실행해야 합니다(HERDR_ENV=1). 화면만 확인하려면 --dry-run."
}

# 워크스페이스 ID. 검증은 현재 셸에서(명령 치환 안에서 exit 하지 않도록) 먼저 한다.
herdr_require_workspace() {
  local ws=${HERDR_WORKSPACE_ID:-}
  [ -n "$ws" ] || herdr_die "HERDR_WORKSPACE_ID가 없습니다. Herdr 패널 안에서 실행하거나, 계획만 보려면 Herdr 밖에서 HERDR_WORKSPACE_ID=<id>와 --dry-run을 함께 주세요."
}
herdr_workspace() { printf '%s' "${HERDR_WORKSPACE_ID:-}"; }

# 작은따옴표로 안전하게 감싼다. 대상 셸에서 재해석되지 않는 형태로 CLI 인자를 넘길 때 쓴다.
herdr_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# herdr_call <args...> : dry-run이면 실행할 명령만 출력한다.
herdr_call() {
  if herdr_is_dry; then
    printf '[dry-run] herdr'
    printf ' %s' "$@"
    printf '\n'
    return 0
  fi
  herdr "$@"
}

# 화면 마지막 N개(비어 있지 않은) 줄.
herdr_bottom_lines() {
  printf '%s\n' "$1" | awk 'NF {a[++n]=$0} END {for (i=(n>8?n-7:1); i<=n; i++) print a[i]}'
}

# 상태줄을 고른다. "마지막 비어 있지 않은 줄"이 아니라:
#  - OpenCode: 'Build' 가 들어 있는 줄 (버전 번호 줄이 마지막인 경우가 있음)
#  - Codex: 모델명(needle, 대소문자 무시)이 들어 있는 줄
#  - 그 외: '·' 또는 '~/' 가 들어 있는 줄, 최후에는 마지막 비어 있지 않은 줄.
# needle 은 선택 인자(모델 표기·검증 문자열)다. 메뉴 잔상·입력 echo는 근거로 쓰지 않는다.
herdr_status_line() { # <screen> [needle]
  local screen=$1 needle=${2:-}
  printf '%s\n' "$screen" | awk -v needle="$needle" '
    NF { lines[++n] = $0 }
    END {
      # OpenCode: Build 포함 줄(아래에서 위로, 가장 아래 것)
      for (i = n; i >= 1; i--) {
        if (tolower(lines[i]) ~ /build/) { print lines[i]; exit }
      }
      # Codex 상태줄: 경로 표기(~\/)가 있는 줄을 우선한다(꼬리 줄의 중간점과 구분).
      for (i = n; i >= 1; i--) {
        if (index(lines[i], "~/") > 0) { print lines[i]; exit }
      }
      # 중간점(·)이 있는 줄(OpenCode effort 표기, Codex 상태줄)
      for (i = n; i >= 1; i--) {
        if (index(lines[i], "·") > 0) { print lines[i]; exit }
      }
      # needle 이 주어지면 그 문자열(대소문자 무시)이 들어 있는 줄
      if (needle != "") {
        nl = tolower(needle)
        for (i = n; i >= 1; i--) {
          if (index(tolower(lines[i]), nl) > 0) { print lines[i]; exit }
        }
      }
      if (n > 0) print lines[n]
    }'
}

# 하위 호환: herdr_last_line 은 herdr_status_line 의 별칭이다(needle 선택 인자 지원).
herdr_last_line() { # <screen> [needle]
  herdr_status_line "$@"
}

# 화면 읽기: 남은 시간 한도(기본 HERDR_READ_TIMEOUT)를 넘기면 SIGTERM → 1초 유예 → SIGKILL.
# 본인이 띄운 자식 프로세스만 종료한다.
herdr_read_limited() { # <pane> [limit_seconds]
  local pane=$1 limit=${2:-$HERDR_READ_TIMEOUT}
  local tmp pid ticks=0 max i=0
  max=$((10#$limit * 10))
  tmp=$(mktemp "${TMPDIR:-/tmp}/herdr-read.XXXXXX") || herdr_die "임시 파일을 만들지 못했습니다."
  herdr pane read "$pane" --source visible >"$tmp" 2>/dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -ge "$max" ]; then
      # 본인이 띄운 자식과 그 자식들만 종료한다(TERM → 1초 유예 → KILL).
      for child in $(pgrep -P "$pid" 2>/dev/null); do
        kill -TERM "$child" 2>/dev/null || true
      done
      kill -TERM "$pid" 2>/dev/null || true
      while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do
        sleep 0.1
        i=$((i + 1))
      done
      for child in $(pgrep -P "$pid" 2>/dev/null); do
        kill -KILL "$child" 2>/dev/null || true
      done
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      rm -f "$tmp"
      herdr_warn "'$pane' 화면 읽기가 ${limit}초를 넘겨 중단했습니다."
      return 1
    fi
    sleep 0.1
    ticks=$((ticks + 1))
  done
  wait "$pid" 2>/dev/null || true
  cat -- "$tmp"
  rm -f "$tmp"
}

# 폴링 루프에서 쓸 읽기 한도: 바깥 deadline의 남은 시간과 개별 한도 중 작은 값(최소 1초).
herdr_read_limit_for() { # <시작초> <timeout>
  local left=$(( $2 - (SECONDS - $1) ))
  [ "$left" -lt 1 ] && left=1
  [ "$left" -gt "$HERDR_READ_TIMEOUT" ] && left=$HERDR_READ_TIMEOUT
  printf '%s' "$left"
}

# 남은 시간보다 길게 자지 않는다: sleep = min(폴링 간격, 남은 초). 남은 시간이 1초 미만이면 1초로 본다.
herdr_sleep_seconds() { # <경과초> <timeout>
  local left=$(( $2 - $1 ))
  [ "$left" -lt 1 ] && left=1
  awk -v poll="$HERDR_POLL_SECONDS" -v left="$left" '
    BEGIN { s = (poll < left) ? poll : left; if (s <= 0) s = 0.1; printf "%.2f", s }'
}
herdr_sleep_for() { # <시작초> <timeout>
  sleep "$(herdr_sleep_seconds $((SECONDS - $1)) "$2")"
}

herdr_visible() { herdr_read_limited "$1"; }

herdr_send_text() {
  if herdr_is_dry; then
    printf '[dry-run] herdr pane send-text %s %s\n' "$1" "$(herdr_quote "$2")"
    return 0
  fi
  herdr pane send-text "$1" "$2"
}

herdr_send_keys() { # <pane> <key>...
  local pane=$1
  shift
  if herdr_is_dry; then
    printf '[dry-run] herdr pane send-keys %s' "$pane"
    printf ' %s' "$@"
    printf '\n'
    return 0
  fi
  herdr pane send-keys "$pane" "$@"
}

herdr_enter() { herdr_send_keys "$1" enter; }

# 화면에 정규식이 보일 때까지 폴링한다.
herdr_wait_for() { # <pane> <ERE> [timeout]
  local pane=$1 pattern=$2 timeout=${3:-$HERDR_STEP_TIMEOUT}
  if herdr_is_dry; then
    printf '[dry-run] wait ~ /%s/ on %s (<=%ss)\n' "$pattern" "$pane" "$timeout"
    return 0
  fi
  local start=$SECONDS text
  while :; do
    text=$(herdr_read_limited "$pane" "$(herdr_read_limit_for "$start" "$timeout")") || return 2
    if printf '%s\n' "$text" | grep -Eqi -- "$pattern"; then return 0; fi
    if [ $((SECONDS - start)) -ge "$timeout" ]; then
      herdr_warn "'$pane' 화면에서 /$pattern/ 을(를) ${timeout}초 안에 보지 못했습니다."
      return 1
    fi
    herdr_sleep_for "$start" "$timeout"
  done
}

# 입력 에코 확인(P5). send-text 직후 enter를 붙이지 않기 위한 동기화 지점이다.
herdr_wait_echo() { # <pane> <sent-text> [timeout]
  local pane=$1 text=$2 timeout=${3:-$HERDR_STEP_TIMEOUT} probe
  probe=$(printf '%s' "$text" | head -1 | cut -c1-40)
  if herdr_is_dry; then
    printf '[dry-run] wait echo "%s" on %s (<=%ss)\n' "$probe" "$pane" "$timeout"
    return 0
  fi
  local start=$SECONDS screen
  while :; do
    screen=$(herdr_read_limited "$pane" "$(herdr_read_limit_for "$start" "$timeout")") || return 2
    case "$screen" in
      *"$probe"*) return 0 ;;
    esac
    if [ $((SECONDS - start)) -ge "$timeout" ]; then
      herdr_warn "'$pane' 화면에 입력 에코를 ${timeout}초 안에 보지 못했습니다."
      return 1
    fi
    herdr_sleep_for "$start" "$timeout"
  done
}

# 메뉴 화면 확인: 제목이 **줄 앞**에 오고 커서 표시가 같은 화면에 있어야 한다(B2).
# 입력 에코(`/models` 같은 줄)를 메뉴로 오인하지 않도록 제목은 줄 시작에 고정한다.
# 성공하면 마지막 화면을 HERDR_MENU_SCREEN 에 남긴다.
HERDR_MENU_SCREEN=""
herdr_wait_menu() { # <pane> <title-ERE> [timeout]
  local pane=$1 title=$2 timeout=${3:-$HERDR_STEP_TIMEOUT}
  if herdr_is_dry; then
    printf '[dry-run] wait menu ^/ %s / + cursor on %s (<=%ss)\n' "$title" "$pane" "$timeout"
    HERDR_MENU_SCREEN=""
    return 0
  fi
  local start=$SECONDS text
  while :; do
    text=$(herdr_read_limited "$pane" "$(herdr_read_limit_for "$start" "$timeout")") || return 2
    if printf '%s\n' "$text" | grep -Eq -- "^[[:space:]│|]*($title)" &&
       printf '%s\n' "$text" | grep -Eq -- '(^|[[:space:]])[>›❯*][[:space:]]'; then
      HERDR_MENU_SCREEN=$text
      return 0
    fi
    if [ $((SECONDS - start)) -ge "$timeout" ]; then
      herdr_warn "'$pane' 화면에서 메뉴(^/$title/ + 커서)를 ${timeout}초 안에 확인하지 못했습니다."
      return 1
    fi
    herdr_sleep_for "$start" "$timeout"
  done
}

# 표기 정규화: 대소문자·하이픈·공백·구두점 차이를 없앤다.
herdr_normalize() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]'
}

# 상태줄(마지막 한 줄)에 문자열이 있는지 정규화 비교한다. 모델·공급자 표기용.
herdr_verify_text() { # <pane> <표시 문자열> [timeout]
  local pane=$1 text=$2 timeout=${3:-$HERDR_VERIFY_TIMEOUT} needle
  needle=$(herdr_normalize "$text")
  [ -n "$needle" ] || herdr_die "상태줄 검증 문자열이 비어 있습니다."
  if herdr_is_dry; then
    printf '[dry-run] verify status text "%s" on %s (normalized, last line)\n' "$text" "$pane"
    return 0
  fi
  local start=$SECONDS line status
  while :; do
    line=$(herdr_read_limited "$pane" "$(herdr_read_limit_for "$start" "$timeout")") || return 2
    status=$(herdr_last_line "$line" "$text")
    case "$(herdr_normalize "$status")" in
      *"$needle"*) return 0 ;;
    esac
    if [ $((SECONDS - start)) -ge "$timeout" ]; then return 1; fi
    herdr_sleep_for "$start" "$timeout"
  done
}

# 상태줄에서 effort 토큰이 **완전히 일치**하는지 확인한다(xhigh ≠ high).
# 근거는 마지막 줄 하나뿐이라 메뉴 잔상·입력 echo 로 통과하지 않는다.
herdr_verify_effort() { # <pane> <effort> [timeout]
  local pane=$1 effort=$2 timeout=${3:-$HERDR_VERIFY_TIMEOUT}
  if herdr_is_dry; then
    printf '[dry-run] verify status effort token "%s" on %s (last line, exact)\n' "$effort" "$pane"
    return 0
  fi
  local start=$SECONDS text status
  while :; do
    text=$(herdr_read_limited "$pane" "$(herdr_read_limit_for "$start" "$timeout")") || return 2
    status=$(herdr_last_line "$text" "$effort")
    if printf '%s\n' "$status" | awk -v target="$effort" '
        {
          line = $0
          gsub(/[·•|,;:()\[\]{}]/, " ", line)
          n = split(line, w, /[[:space:]]+/)
          for (i = 1; i <= n; i++) {
            token = w[i]
            gsub(/[^A-Za-z0-9_-]/, "", token)
            if (tolower(token) == tolower(target)) { found = 1; exit }
          }
        }
        END { exit (found ? 0 : 1) }'; then
      return 0
    fi
    if [ $((SECONDS - start)) -ge "$timeout" ]; then return 1; fi
    herdr_sleep_for "$start" "$timeout"
  done
}

# 메뉴 목록 스캔: "목표 항목 인덱스", "현재 커서 인덱스", "현재 커서 줄" 세 줄을 낸다.
# - [title] 을 주면 제목 줄 아래만 목록으로 본다(입력 에코·검색창 제외).
# - 모델·공급자는 표기 정규화 후 비교한다(slug 대 표시 문자열).
# - 인덱스는 0-based, 목록 항목 기준. 못 찾으면 -1.
herdr_row_scan() { # <screen> <모델 표시어> <공급자 표시어> [title-ERE]
  local screen=$1 term=$2 provider=$3 title=${4:-}
  printf '%s\n' "$screen" | awk -v term="$term" -v prov="$provider" -v title="$title" '
    function norm(s,   i, c, o) {
      o = ""
      s = tolower(s)
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c ~ /[a-z0-9]/) o = o c
      }
      return o
    }
    function is_search_box(line,   l) {
      l = tolower(line)
      if (l ~ /^[[:space:]│|>›❯]*[[:space:]]*(search|filter|find|검색|찾기)[[:space:]:：]/) return 1
      if (index(l, "search:") > 0 || index(l, "filter:") > 0) return 1
      return 0
    }
    BEGIN { n = 0; cursor = -1; target = -1; rowtext = ""; inlist = (title == "") }
    {
      if (!inlist) {
        if ($0 ~ ("^[[:space:]│|]*(" title ")")) { inlist = 1 }
        next
      }
      if (is_search_box($0)) next
      if ($0 ~ /^[[:space:]]*$/) next
      idx = n
      n++
      marked = ($0 ~ /(^|[[:space:]])[>›❯*][[:space:]]/)
      if (marked && cursor < 0) { cursor = idx; rowtext = $0 }
      if (target < 0) {
        lt = norm($0)
        if (index(lt, norm(term)) > 0 && (prov == "" || index(lt, norm(prov)) > 0)) target = idx
      }
    }
    END { print target; print cursor; print rowtext }'
}

# 상태줄의 공급자 표기를 모델 표기와 effort 낱말을 걷어 내고 남은 정규화 문자열로 읽는다.
# 예) "DeepSeek V4.1 Flash Ollama Cloud · high" + model label "DeepSeek V4.1 Flash" → "ollamacloud"
# 읽지 못하면(빈 문자열) 1을 돌려준다. 공급자 표기가 모델·effort 낱말과 겹치면 부정확할 수 있다.
herdr_status_provider() { # <상태줄> <모델 표시어>
  local line model rest word
  line=$(herdr_normalize "$1")
  model=$(herdr_normalize "$2")
  [ -n "$model" ] || return 1
  rest=${line//$model/}
  for word in minimal low medium high xhigh effort reasoning max variant; do
    rest=${rest//$word/}
  done
  [ -n "$rest" ] || return 1
  printf '%s' "$rest"
}

# 표시자(> › ❯ *)가 붙은 줄에서 <word...> 중 **완전히 일치**하는 단어의 0-based 순번.
# 부분 문자열 비교는 xhigh 를 high 로 오인하므로 금지한다.
herdr_menu_index() { # <screen> <word>...
  local screen=$1
  shift
  printf '%s\n' "$screen" | awk -v words="$(printf '%s ' "$@")" '
    function has_word(line, w,   re) {
      re = "(^|[^A-Za-z0-9_-])" w "([^A-Za-z0-9_-]|$)"
      return match(tolower(line), tolower(re)) > 0
    }
    BEGIN { n = split(words, w, " "); found = 0 }
    {
      if (found) next
      if ($0 !~ /(^|[[:space:]])[>›❯*][[:space:]]/) next
      for (i = 1; i <= n; i++) {
        if (has_word($0, w[i])) { print i - 1; found = 1; exit }
      }
    }
    END { if (!found) print -1 }'
}

# 목표 항목까지의 이동량(양수면 Down, 음수면 Up). 확인 불가면 1을 돌려준다.
herdr_row_delta() { # <screen> <모델 표시어> <공급자 표시어> [title]
  local scan target cursor
  scan=$(herdr_row_scan "$@")
  target=$(printf '%s\n' "$scan" | sed -n 1p)
  cursor=$(printf '%s\n' "$scan" | sed -n 2p)
  case "$target$cursor" in -1*|*-1) return 1 ;; esac
  printf '%s' "$((target - cursor))"
}

# Enter 직전 재확인: 지금 커서 줄이 목표 모델(+공급자)인지 정규화 비교한다. 0=일치.
herdr_cursor_matches() { # <pane> <모델 표시어> <공급자 표시어|""> [title]
  local pane=$1 term=$2 provider=$3 title=${4:-} row norm
  row=$(herdr_row_scan "$(herdr_visible "$pane")" "$term" "$provider" "$title" | sed -n 3p)
  norm=$(herdr_normalize "$row")
  [ -n "$norm" ] || return 1
  case "$norm" in *"$(herdr_normalize "$term")"*) ;; *) return 1 ;; esac
  [ -n "$provider" ] || return 0
  case "$norm" in *"$(herdr_normalize "$provider")"*) return 0 ;; esac
  return 1
}

# 지정 이름이 이미 있으면 숫자를 붙여 최대 20회 재시도하고 최종 이름을 출력한다.
# 실패는 숨기지 않는다: 1을 돌려주고 호출부가 종료 코드를 결정한다.
herdr_rename_agent() { # <pane> <name>
  local pane=$1 name=$2 target=$2 n=2 err
  if herdr_is_dry; then
    printf '[dry-run] herdr agent rename %s %s\n' "$pane" "$name" >&2
    printf '%s\n' "$name"
    return 0
  fi
  while :; do
    if err=$(herdr agent rename "$pane" "$target" 2>&1); then
      printf '%s\n' "$target"
      return 0
    fi
    case "$err" in
      *agent_name_taken*)
        if [ "$n" -gt 20 ]; then
          herdr_warn "'$name' 에이전트 이름 재시도 한도 초과"
          return 1
        fi
        target="${name}${n}"
        n=$((n + 1))
        ;;
      *)
        herdr_warn "'$target' 에이전트 이름 지정 실패 ($err)"
        return 1
        ;;
    esac
  done
}
