ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS progress_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_summary TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE job_runs
SET idempotency_key = run_id
WHERE idempotency_key IS NULL;

ALTER TABLE job_runs
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN started_at DROP NOT NULL,
  ALTER COLUMN started_at DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS job_runs_idempotency_key_idx
  ON job_runs (idempotency_key);

CREATE INDEX IF NOT EXISTS job_runs_status_created_idx
  ON job_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_heartbeat_idx
  ON job_runs (status, heartbeat_at);
