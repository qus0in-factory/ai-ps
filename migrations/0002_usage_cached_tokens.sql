-- 캐시 적중 토큰 기록(설계 /tmp/token-spec.md §16). 기존 행은 NULL로 둔다.
ALTER TABLE usage_events ADD COLUMN cached_tokens INTEGER;
