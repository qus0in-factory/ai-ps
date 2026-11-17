#!/usr/bin/env bash
# 프롬프트 파일 내용을 그대로 워커에게 전송한다.
#
# printf 로 문자열을 조립하지 않는다(파일 속 %s·%d 가 형식 지시자로 해석되는 사고 방지).
# 파일은 있는 그대로 읽어 인자 하나로 넘기며, 끝의 개행도 보존한다.
#
# 사용: scripts/herdr-send.sh <name> <prompt-file> [--dry-run] [--help]
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib/herdr.sh
. "$script_dir/lib/herdr.sh"

usage() {
  cat <<'USAGE'
사용: scripts/herdr-send.sh <에이전트이름> <프롬프트파일> [--dry-run]

프롬프트 파일 내용을 그대로(`herdr agent prompt`) 보낸다. 끝 개행도 보존한다.
--dry-run 은 파일 경로와 바이트 수만 출력하고 내용은 출력하지 않는다.

옵션:
  --dry-run   보낼 대상과 파일 크기만 출력한다
  --help

예:
  scripts/herdr-send.sh ps-ds /tmp/ps-prompts/ds.md
USAGE
}

name=""; file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) HERDR_DRY_RUN=1; shift ;;
    -*) herdr_die "알 수 없는 옵션: $1" ;;
    *)
      if [ -z "$name" ]; then name=$1
      elif [ -z "$file" ]; then file=$1
      else herdr_die "인자가 너무 많습니다: $1"
      fi
      shift
      ;;
  esac
done

[ -n "$name" ] && [ -n "$file" ] || { usage >&2; exit 64; }
[ -f "$file" ] || herdr_die "프롬프트 파일이 없습니다: $file"
[ -r "$file" ] || herdr_die "프롬프트 파일을 읽을 수 없습니다: $file"

bytes=$(wc -c < "$file" | tr -d ' ')
[ "$bytes" -gt 0 ] || herdr_die "프롬프트 파일이 비어 있습니다: $file"

if herdr_is_dry; then
  # 원문·미리보기를 출력하지 않는다: 프롬프트에 비밀값이 섞여도 로그에 남기지 않기 위함이다(B/R3).
  lines=$(awk 'END {print NR}' "$file")
  printf '[dry-run] herdr agent prompt %s < %s (%s bytes, %s lines)\n' "$name" "$file" "$bytes" "$lines"
  exit 0
fi

herdr_check_env
# 끝 개행 보존: command substitution 은 trailing newline 을 지우므로 sentinel 을 붙였다 뗀다.
content=$(cat -- "$file"; printf 'X')
content=${content%X}
herdr agent prompt "$name" "$content"
printf '%s ← %s (%s bytes)\n' "$name" "$file" "$bytes"
