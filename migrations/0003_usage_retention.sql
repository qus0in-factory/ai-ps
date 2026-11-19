-- usage_events는 호출 지표만 담는다. 35일(ts, epoch ms)보다 오래된 행은 매일 Cron Trigger가 삭제한다.
CREATE INDEX IF NOT EXISTS usage_events_ts ON usage_events(ts);
