CREATE TABLE usage_events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, route TEXT NOT NULL, service TEXT NOT NULL, op TEXT NOT NULL, model TEXT, status INTEGER NOT NULL, ms INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL NOT NULL DEFAULT 0);
CREATE INDEX usage_events_ts ON usage_events(ts);
