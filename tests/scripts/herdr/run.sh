#!/usr/bin/env bash
# tests/scripts/herdr 회귀 테스트 실행기. 실제 Herdr 패널은 건드리지 않는다(가짜 실행 파일만).
set -uo pipefail

dir=$(cd "$(dirname "$0")" && pwd)
failed=0
for test in "$dir"/*.test.sh; do
  printf '\n== %s\n' "$(basename "$test")"
  if bash "$test"; then
    :
  else
    failed=$((failed + 1))
  fi
done

if [ "$failed" -ne 0 ]; then
  printf '\n실패한 테스트 파일: %d\n' "$failed" >&2
  exit 1
fi
printf '\n모든 Herdr 회귀 테스트 통과\n'
