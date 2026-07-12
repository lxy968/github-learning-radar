CREATE TABLE IF NOT EXISTS detailed_study_plans (
  plan_id TEXT PRIMARY KEY,
  repo_id BIGINT NOT NULL,
  repo_full_name TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK (duration IN (3, 7, 14)),
  source TEXT NOT NULL,
  based_on_pushed_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  plan JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, duration)
);

CREATE INDEX IF NOT EXISTS detailed_study_plans_repo_generated_idx
  ON detailed_study_plans (repo_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_rate_limits_updated_idx
  ON api_rate_limits (updated_at);
