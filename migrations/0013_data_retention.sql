CREATE TABLE IF NOT EXISTS radar_run_archives (
  run_id TEXT PRIMARY KEY,
  finished_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS radar_run_archives_finished_idx
  ON radar_run_archives (finished_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_terminal_finished_idx
  ON job_runs (status, finished_at)
  WHERE status IN ('success', 'partial', 'failed', 'cancelled');

CREATE INDEX IF NOT EXISTS repositories_retention_updated_idx
  ON repositories (updated_at, pushed_at);
