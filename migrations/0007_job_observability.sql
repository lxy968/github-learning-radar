ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS error_category TEXT,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS job_runs_claim_idx
  ON job_runs (job_name, status, available_at, created_at);

ALTER TABLE radar_runs
  ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;
